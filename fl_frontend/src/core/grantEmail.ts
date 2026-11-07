import "server-only";

import { mailOrigin } from "./emailShell";
import { ERASED_ACTOR_MARKER } from "./erasedActor";
import { ROUTES } from "./routes";
import { SERVER_COPY } from "./serverCopy";

import type { Mail, Paragraph } from "./emailShell";
import type { FLGrantData } from "./generated/client/types";
import type { MailOrigin } from "./mailKinds";

const WORDS = SERVER_COPY.mail.grant;

function subjectOf({ change, stage }: FLGrantData): string {
  if (change === "revoked") return WORDS.subject.revoked;

  return stage === "started" ? WORDS.subject[change] : WORDS.subject[stage];
}

function leadOf({ change, stage, address, new_address }: FLGrantData): string {
  const named = address ?? WORDS.unnamedAddress;
  // The lead's object, after „an“: an erased address reads lower-case there.
  const object = address ?? WORDS.unnamedTarget;
  // An address change's alone, and masked: a holder learns which mailbox moves, and not all of where to.
  const next = new_address ?? WORDS.unnamedActor;

  switch (change) {
    case "revoked":
      return WORDS.lead.revoked(named);
    case "granted":
      return stage === "withdrawn" ? WORDS.lead.withdrawn.granted(named) : WORDS.lead.granted(named);
    case "handover":
      if (stage === "completed") return WORDS.lead.completed.handover(named);
      return stage === "withdrawn" ? WORDS.lead.withdrawn.handover(object) : WORDS.lead.handover(object);
    case "address":
      if (stage === "completed") {
        return address === null
          ? WORDS.lead.completed.unnamedAddress
          : WORDS.lead.completed.address(address, new_address ?? WORDS.unnamedTarget);
      }
      return stage === "withdrawn" ? WORDS.lead.withdrawn.address(named, next) : WORDS.lead.address(named, next);
  }
}

/** Who acted and when, then when it takes effect; a press or a pass naming nobody states its date alone. */
function factsOf({ change, stage, changed_by, changed_at, effective_from }: FLGrantData): Paragraph | null {
  const takesEffect = effective_from === null ? null : WORDS.effectiveFrom(effective_from);
  if (changed_by === null) return takesEffect === null ? null : [takesEffect];

  const actor = changed_by === ERASED_ACTOR_MARKER ? WORDS.unnamedActor : changed_by;
  const by = stage === "withdrawn" ? WORDS.by.withdrawn : change === "revoked" ? WORDS.by.removed : WORDS.by.entered;

  return takesEffect === null ? [by(actor, changed_at)] : [by(actor, changed_at), takesEffect];
}

/**
 * **The body depends on the change alone**, never on when it is sent or to whom: every holder is owed the same notice.
 * An addition's start is a first contact, the address having come from the owner and perhaps been mistyped, so it
 * carries the Art. 21 line and its „Nicht du?“.
 */
export function buildGrantEmail(data: FLGrantData, { origin: rawOrigin }: MailOrigin): Mail {
  const origin = mailOrigin(rawOrigin);
  const facts = factsOf(data);

  return {
    kind: data.change === "granted" && data.stage === "started" ? "firstContact" : "notice",
    subjectLine: subjectOf(data),
    origin,
    firstName: "",
    paragraphs: [[leadOf(data)], ...(facts === null ? [] : [facts]), [WORDS.warn]],
    ...(data.stage === "started" ? { button: { label: WORDS.button, href: `${origin}${ROUTES.adminAdministrators.path()}` } } : {}),
  };
}
