import "server-only";

import { ROUTES } from "./routes";
import { SERVER_COPY } from "./serverCopy";

import type { Copy } from "./copy";
import type { Mail, Paragraph } from "./emailShell";
import type { FLGrantData } from "./generated/client/types";
import type { MailRecipient } from "./mailKinds";

const WORDS = SERVER_COPY.mail.grant;

function subjectOf({ change, stage }: FLGrantData): Copy {
  if (change === "revoked") return WORDS.subject.revoked;
  if (stage === "withdrawn") return WORDS.subject.withdrawn;
  // An addition holds from its start, so the backend never completes one: its lead keeps the start's words too.
  if (stage === "started" || change === "granted") return WORDS.subject[change];

  return WORDS.subject.completed[change];
}

function leadOf({ change, stage, address, new_address }: FLGrantData): Copy {
  const named = address ?? WORDS.unnamedAddress;
  // The lead's object, after „an“: an erased address reads lower-case there.
  const object = address ?? WORDS.unnamedTarget;
  // An address change's alone, and masked: a holder learns which mailbox moves, and not all of where to.
  const next = new_address ?? WORDS.unnamedNewAddress;

  switch (change) {
    case "revoked":
      return WORDS.lead.revoked(named);
    case "granted":
      return stage === "withdrawn" ? WORDS.lead.withdrawn.granted(named) : WORDS.lead.granted(named);
    case "handover":
      if (stage === "completed") return WORDS.lead.completed.handover(named);
      return stage === "withdrawn" ? WORDS.lead.withdrawn.handover(object) : WORDS.lead.handover(object);
    case "address":
      if (stage === "completed") return WORDS.lead.completed.address(named, next);
      return stage === "withdrawn" ? WORDS.lead.withdrawn.address(named, next) : WORDS.lead.address(named, next);
  }
}

/**
 * **The body depends on the change alone**, never on when it is sent or to whom: every holder is owed the same notice.
 * An addition's start is a first contact for the address it names alone, that address having come from the owner and
 * perhaps been mistyped, so that copy carries the Art. 21 line and its „Nicht du?“. No holder in office shares the
 * address, which the grants hold once each.
 */
export function buildGrantEmail(data: FLGrantData, { origin, to }: MailRecipient): Mail {
  const { effective_from: effectiveFrom } = data;
  const takesEffect: Paragraph[] = effectiveFrom === null ? [] : [[WORDS.effectiveFrom(effectiveFrom)]];
  const firstContact = data.change === "granted" && data.stage === "started" && to === data.address;

  return {
    audience: firstContact ? "firstContact" : "notice",
    subjectLine: subjectOf(data),
    origin,
    paragraphs: [[leadOf(data)], ...takesEffect, [WORDS.warn]],
    ...(data.stage === "started" ? { button: { label: WORDS.button, href: `${origin}${ROUTES.adminAdministrators.path()}` } } : {}),
  };
}
