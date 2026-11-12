import { describe, expect, it } from "vitest";

const { mailFor } = await import("./mailKinds.ts");
const { OBJECTION } = await import("./emailShell.ts");

describe("a ban's notice", () => {
  /* Art. 21 (4): separate from the rest and at the first communication, which is this mail, and no other part of it says so. */
  it("closes on the objection, as a paragraph of its own", () => {
    const mail = mailFor(
      "ban",
      { kind: "ban", ban_reason: "Wiederholt gemeldet", barred_until_saison_id: "2627" },
      { token: null, secret: null, origin: "http://localhost:3000" },
    );

    expect(mail?.afterBlock?.at(-1)).toStrictEqual([OBJECTION]);
  });
});
