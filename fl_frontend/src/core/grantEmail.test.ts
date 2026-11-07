import { describe, expect, it } from "vitest";

import { formatInstant } from "./format.ts";

import type { FLGrantData } from "./generated/client/types.ts";

const { mailFor } = await import("./mailKinds.ts");
const { renderMail } = await import("./emailShell.ts");
const { SERVER_COPY } = await import("./serverCopy.ts");

const WORDS = SERVER_COPY.mail.grant;
const ADDRESS = "nora.neu@beispielschule.de";
const OWNER = "inhaberin@frankfurtleague.de";
const AT = "2126-04-01T10:30:00+00:00";
const FROM = "2126-04-08T10:30:00+00:00";

const facts = (fields: Partial<FLGrantData>): FLGrantData => ({
  kind: "grant",
  change: "granted",
  stage: "started",
  address: ADDRESS,
  new_address: null,
  changed_by: OWNER,
  changed_at: AT,
  effective_from: null,
  ...fields,
});

const rendered = (fields: Partial<FLGrantData>) => {
  const mail = mailFor("grant", facts(fields), { token: null, secret: null, origin: "http://localhost:3000" });
  if (mail === undefined) throw new Error("the kind has no builder");

  return renderMail(mail).text;
};

describe("a grant notice", () => {
  /* The date is what its reader acts by, and a lost mailbox's change states no actor to hang it on. */
  it("states the date of what waits with no actor beside it", () => {
    const text = rendered({ change: "address", new_address: "n•••@g•••.de", changed_by: null, effective_from: FROM });

    expect(text).toContain(WORDS.effectiveFrom(FROM));
    expect(text).not.toContain(formatInstant(AT));
  });

  /* The address came from the owner and may be mistyped, so this may be a stranger's first word from the league. */
  it("carries the Art. 21 line and its „Nicht du?“ on an addition's start and on nothing later", () => {
    const objection = SERVER_COPY.mail.objection.before;
    const notYou = SERVER_COPY.mail.notYou.firstContact;

    expect(rendered({ effective_from: FROM })).toContain(objection);
    expect(rendered({ effective_from: FROM })).toContain(notYou);
    expect(rendered({ stage: "withdrawn" })).not.toContain(objection);
    expect(rendered({ change: "handover", effective_from: FROM })).not.toContain(notYou);
  });

  it.each([
    ["handover", "started", WORDS.lead.handover(WORDS.unnamedTarget)],
    ["handover", "withdrawn", WORDS.lead.withdrawn.handover(WORDS.unnamedTarget)],
    ["address", "withdrawn", WORDS.lead.withdrawn.address(WORDS.unnamedAddress, WORDS.unnamedActor)],
    ["address", "completed", WORDS.lead.completed.unnamedAddress],
  ] as const)("reads an erased address as a sentence on a %s %s", (change, stage, lead) => {
    expect(rendered({ change, stage, address: null })).toContain(lead);
  });

  it("names the moved address's old side where only the mask was erased", () => {
    const text = rendered({ change: "address", stage: "withdrawn" });

    expect(text).toContain(WORDS.lead.withdrawn.address(ADDRESS, WORDS.unnamedActor));
  });
});
