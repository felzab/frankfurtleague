import { describe, expect, it } from "vitest";

import type { FLGrantData } from "./generated/client/types.ts";

const { mailFor } = await import("./mailKinds.ts");
const { renderMail } = await import("./emailShell.ts");
const { SERVER_COPY } = await import("./serverCopy.ts");

const WORDS = SERVER_COPY.mail.grant;
const ADDRESS = "nora.neu@beispielschule.de";
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

const rendered = (fields: Partial<FLGrantData>) => {
  const mail = mailFor("grant", facts(fields), { token: null, secret: null, origin: "http://localhost:3000" });
  if (mail === undefined) throw new Error("the kind has no builder");

  return renderMail(mail).text;
};

describe("a grant notice", () => {
  /* The address came from the owner and may be mistyped, so this may be a stranger's first word from the league. */
  it("carries the Art. 21 line and its „Nicht du?“ on an addition's start and on nothing later", () => {
    const objection = SERVER_COPY.mail.objection.before;
    const notYou = SERVER_COPY.mail.notYou.firstContact;

    expect(rendered({ effective_from: FROM })).toContain(objection);
    expect(rendered({ effective_from: FROM })).toContain(notYou);
    expect(rendered({ stage: "withdrawn" })).not.toContain(objection);
    expect(rendered({ change: "handover", effective_from: FROM })).not.toContain(notYou);
  });

  it("reads an erased address as a sentence on a handover's withdrawal", () => {
    expect(rendered({ change: "handover", stage: "withdrawn", address: null })).toContain(WORDS.lead.withdrawn.handover(WORDS.unnamedTarget));
  });

  it("names the moved address's old side where the new one was erased", () => {
    const text = rendered({ change: "address", stage: "withdrawn" });

    expect(text).toContain(WORDS.lead.withdrawn.address(ADDRESS, WORDS.unnamedNewAddress));
  });

  /* The completed change's lead takes the builder's stand-ins for an erased side, a subject's and a dative's, so its
     sentence has to read with either one in either place. */
  it.each([
    { previous: ADDRESS, next: "nora.neu@zweitschule.de", lead: "nora.neu@beispielschule.de ist jetzt zu nora.neu@zweitschule.de gewechselt." },
    { previous: null, next: "nora.neu@zweitschule.de", lead: "Eine nicht genannte Adresse ist jetzt zu nora.neu@zweitschule.de gewechselt." },
    { previous: ADDRESS, next: null, lead: "nora.neu@beispielschule.de ist jetzt zu einer nicht genannten Adresse gewechselt." },
    { previous: null, next: null, lead: "Eine nicht genannte Adresse ist jetzt zu einer nicht genannten Adresse gewechselt." },
  ])("reads the completed address change as a sentence from $previous to $next", ({ previous, next, lead }) => {
    expect(rendered({ change: "address", stage: "completed", address: previous, new_address: next })).toContain(lead);
  });
});
