import { describe, expect, it } from "vitest";

import { CustomTimeStringSchema, KONTAKT_EMAIL_MAX_LENGTH, KontaktEmailSchema } from "./schemas.ts";

describe("KontaktEmailSchema", () => {
  const refusals = (value: unknown): string[] => KontaktEmailSchema.safeParse(value).error?.issues.map((issue) => issue.message) ?? [];

  // Each is a value the API takes, and `z.email()`'s alphabet refuses the atext character: a school
  // whose contact address holds one could not submit an application at all.
  it("takes every address the API stores, punycode domains and atext characters and all", () => {
    const addresses = ["kaethe@xn--kthe-schule-l8a.example", "a!b@example.de", `${"a".repeat(70)}@example.de`, "Anna@Example.DE"];

    for (const email of addresses) {
      expect(KontaktEmailSchema.safeParse(email).success, `expected "${email}" to be accepted`).toBe(true);
    }
  });

  // Each is one the API answers with a payload_refused marking the box with a generic sentence, which
  // never tells the applicant what to change.
  it("refuses every address the API refuses on its characters and lengths", () => {
    const addresses = [
      "person@ab-.de",
      "anna@-example.de",
      `person@${"a".repeat(70)}.de`,
      "anna@example",
      "anna@1.2.3.4",
      "anna@example..de",
      "anna@example.de.",
      "anna@ex_ample.de",
      ".anna@example.de",
      "anna.@example.de",
      "an..na@example.de",
      "an,na@example.de",
      "an na@example.de",
      "anna@@example.de",
      "kaethe@käthe-schule.example",
    ];

    for (const email of addresses) {
      expect(KontaktEmailSchema.safeParse(email).success, `expected "${email}" to be rejected`).toBe(false);
    }
  });

  // Pydantic strips before it validates, so the API takes this and stores it trimmed. The padding is
  // invisible, which is what makes a refusal over it unactionable.
  it("takes a pasted address padded with spaces and submits it trimmed", () => {
    expect(KontaktEmailSchema.parse("  erika@example.de  ")).toBe("erika@example.de");
  });

  // The API takes this one and stores the address alone. Refused rather than unwrapped: the name is on
  // screen for the applicant to delete, where a quiet rewrite would submit what nobody typed.
  it("refuses an address wrapped in a display name rather than unwrapping it", () => {
    expect(KontaktEmailSchema.safeParse("Erika <erika@example.de>").success).toBe(false);
  });

  // The library leaves these off its list, so the API stores them and a stricter copy refuses what the save takes.
  it("takes the example domains the special-use names leave out", () => {
    for (const email of ["trainer@example.com", "trainer@example.org", "trainer@example.net"]) {
      expect(refusals(email), email).toStrictEqual([]);
    }
  });
});

describe("KontaktEmailSchema's bounds", () => {
  // Every domain label stays under the 63-octet cap, so a boundary case can only fail on the total.
  function addressOfLength(total: number): string {
    const local = "a".repeat(64);
    let remaining = total - local.length - 1;
    const labels: string[] = [];
    while (remaining > 0) {
      const size = Math.min(60, remaining);
      labels.push("b".repeat(size));
      remaining -= size;
      if (remaining > 0) remaining -= 1;
    }
    return `${local}@${labels.join(".")}`;
  }

  // The boundary, not a wildly long string: a bound set anywhere passes that. Past it the API's
  // payload_refused marks the box with a generic sentence, so without this the ceiling went unnamed.
  it("accepts an address at the backend ceiling and refuses the next character, in German", () => {
    const atTheCap = addressOfLength(KONTAKT_EMAIL_MAX_LENGTH);
    expect(atTheCap.length).toBe(KONTAKT_EMAIL_MAX_LENGTH);
    expect(KontaktEmailSchema.safeParse(atTheCap).success, "at the cap").toBe(true);

    const over = KontaktEmailSchema.safeParse(addressOfLength(KONTAKT_EMAIL_MAX_LENGTH + 1));
    expect(over.success, "one over the cap").toBe(false);
    // No union carries the message, so the box names the ceiling rather than calling the address invalid.
    expect(over.error?.issues.map((issue) => issue.message)).toStrictEqual([
      `Die E-Mail-Adresse darf höchstens ${String(KONTAKT_EMAIL_MAX_LENGTH)} Zeichen lang sein.`,
    ]);
  });
});

describe("CustomTimeStringSchema", () => {
  it("accepts HH:MM:SS", () => {
    for (const t of ["00:00:00", "09:05:00", "14:30:00", "23:59:59"]) {
      expect(CustomTimeStringSchema.safeParse(t).success, `expected ${t} to parse`).toBe(true);
    }
  });

  // `z.iso.time()` accepts both of these and the backend's `CustomTimeString` does not, so a
  // looser schema here lets the admin form submit a value the API answers with a 422.
  it("rejects a time without seconds, which the backend rejects too", () => {
    expect(CustomTimeStringSchema.safeParse("14:30").success).toBe(false);
  });

  it("rejects fractional seconds, which the backend rejects too", () => {
    expect(CustomTimeStringSchema.safeParse("14:30:00.5").success).toBe(false);
  });

  it("rejects out-of-range and malformed values", () => {
    for (const t of ["24:00:00", "14:60:00", "14:30:60", "2:30:00", "", "abc"]) {
      expect(CustomTimeStringSchema.safeParse(t).success, `expected ${t} to be rejected`).toBe(false);
    }
  });
});
