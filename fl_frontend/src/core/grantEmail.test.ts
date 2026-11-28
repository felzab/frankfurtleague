import { describe, expect, it } from "vitest";

import { KONTAKT_EMAIL } from "./brand";

import type { FLGrantData } from "./generated/client/types";

const { mailFor } = await import("./mailKinds");
const { renderMail } = await import("./emailShell");
const { SERVER_COPY } = await import("./serverCopy");

const WORDS = SERVER_COPY.mail.grant;
const ADDRESS = "nora.neu@beispielschule.example.org";
const FROM = "2126-04-08T10:30:00+00:00";

const facts = (fields: Partial<FLGrantData>): FLGrantData => ({
  kind: "grant",
  change: "granted",
  stage: "started",
  address: ADDRESS,
  new_address: null,
  effective_from: null,
  ...fields,
});

const HOLDER = "henrik.halter@beispielschule.example.org";

const built = (fields: Partial<FLGrantData>, to = ADDRESS) => {
  const mail = mailFor("grant", facts(fields), { token: null, secret: null, origin: "http://localhost:3000", to });
  if (mail === undefined) throw new Error("the kind has no builder");

  return mail;
};

const rendered = (fields: Partial<FLGrantData>, to = ADDRESS) => renderMail(built(fields, to)).text;

/* The lead as the line under „Hallo,“ shows it, its first letter small (Duden, D 132): a no-op on a stored address,
   which the backend keeps folded to lower case. */
const underGreeting = (lead: string) => `${lead.charAt(0).toLowerCase()}${lead.slice(1)}`;

describe("a grant notice", () => {
  /* A security notice whose subject contradicts its lead is a fault no reader of the mail would report. The rows are
     the pairs the backend sends: it never completes an addition, so that pair reaches no mail. */
  it.each([
    { change: "granted", stage: "started", subject: WORDS.subject.granted },
    { change: "granted", stage: "withdrawn", subject: WORDS.subject.withdrawn },
    { change: "revoked", stage: "completed", subject: WORDS.subject.revoked },
    { change: "handover", stage: "started", subject: WORDS.subject.handover },
    { change: "handover", stage: "withdrawn", subject: WORDS.subject.withdrawn },
    { change: "handover", stage: "completed", subject: WORDS.subject.completed.handover },
    { change: "address", stage: "started", subject: WORDS.subject.address },
    { change: "address", stage: "withdrawn", subject: WORDS.subject.withdrawn },
    { change: "address", stage: "completed", subject: WORDS.subject.completed.address },
  ] as const)("gives the $change notice's $stage stage the subject its lead's meaning requires", ({ change, stage, subject }) => {
    expect(built({ change, stage }).subjectLine).toBe(subject);
  });

  /* The address came from the owner and may be mistyped, so this may be a stranger's first word from the league. A
     holder in office gets the same start, where the line's „reply and we delete your data“ is false. */
  it("carries the Art. 21 line and its „Nicht du?“ on the named address's copy of an addition's start alone", () => {
    const [objection] = SERVER_COPY.mail.objection(KONTAKT_EMAIL);
    const notYou = SERVER_COPY.mail.notYou.firstContact;

    expect(rendered({ effective_from: FROM })).toContain(objection);
    expect(rendered({ effective_from: FROM })).toContain(notYou);
    expect(rendered({ effective_from: FROM }, HOLDER)).not.toContain(objection);
    expect(rendered({ effective_from: FROM }, HOLDER)).not.toContain(notYou);
    expect(rendered({ stage: "withdrawn" })).not.toContain(objection);
    expect(rendered({ change: "handover", effective_from: FROM })).not.toContain(notYou);
  });

  it("reads an erased address as a sentence on a handover's withdrawal", () => {
    expect(rendered({ change: "handover", stage: "withdrawn", address: null })).toContain(
      underGreeting(WORDS.lead.withdrawn.handover(WORDS.unnamedTarget)),
    );
  });

  it("names the moved address's old side where the new one was erased", () => {
    const text = rendered({ change: "address", stage: "withdrawn" });

    expect(text).toContain(WORDS.lead.withdrawn.address(ADDRESS, WORDS.unnamedNewAddress));
  });

  /* The completed change's lead takes the builder's stand-ins for an erased side, a subject's and a dative's, so each
     stand-in has to stand in its own place. */
  const NEXT = "nora.neu@zweitschule.example.org";
  it.each([
    { previous: ADDRESS, next: NEXT, lead: WORDS.lead.completed.address(ADDRESS, NEXT) },
    { previous: null, next: NEXT, lead: WORDS.lead.completed.address(WORDS.unnamedAddress, NEXT) },
    { previous: ADDRESS, next: null, lead: WORDS.lead.completed.address(ADDRESS, WORDS.unnamedNewAddress) },
    { previous: null, next: null, lead: WORDS.lead.completed.address(WORDS.unnamedAddress, WORDS.unnamedNewAddress) },
  ])("reads the completed address change as a sentence from $previous to $next", ({ previous, next, lead }) => {
    expect(rendered({ change: "address", stage: "completed", address: previous, new_address: next })).toContain(underGreeting(lead));
  });
});
