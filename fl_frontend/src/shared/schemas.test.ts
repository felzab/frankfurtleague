import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { z } from "zod";

import {
  ADDRESS_HAUSNUMMER_MAX_LENGTH,
  ADDRESS_STADT_MAX_LENGTH,
  ADDRESS_STADTTEIL_MAX_LENGTH,
  ADDRESS_STRASSE_MAX_LENGTH,
  CustomTimeStringSchema,
  ExternalUrlSchema,
  FLAddressPayloadSchema,
  FLAddressSchema,
  FLKontaktSchema,
  KONTAKT_EMAIL_MAX_LENGTH,
} from "./schemas.ts";

const validAddress = {
  strasse: "Hanauer Landstraße",
  hausnummer: "12a",
  plz: "60314",
  stadtteil: "Ostend",
  stadt: "Frankfurt am Main",
};

describe("FLAddressSchema", () => {
  it("accepts a valid address", () => {
    assert.equal(FLAddressSchema.safeParse(validAddress).success, true);
  });

  it("requires plz to be exactly five digits", () => {
    for (const plz of ["6031", "603145", "6031a", "", " 60314", "60 314"]) {
      assert.equal(FLAddressSchema.safeParse({ ...validAddress, plz }).success, false, `expected "${plz}" to be rejected`);
    }
    assert.equal(FLAddressSchema.safeParse({ ...validAddress, plz: "01067" }).success, true);
  });

  it("accepts hausnummer as digits, hyphens and a/b/c, or empty", () => {
    for (const hausnummer of ["12", "12a", "12-14", "12B", "", "1-3c"]) {
      assert.equal(FLAddressSchema.safeParse({ ...validAddress, hausnummer }).success, true, `expected "${hausnummer}" to be accepted`);
    }
  });

  it("rejects hausnummer with other letters or spaces", () => {
    for (const hausnummer of ["12d", "12 a", "Nr. 12"]) {
      assert.equal(FLAddressSchema.safeParse({ ...validAddress, hausnummer }).success, false, `expected "${hausnummer}" to be rejected`);
    }
  });

  it("requires strasse and stadt to be non-empty but allows an empty stadtteil", () => {
    assert.equal(FLAddressSchema.safeParse({ ...validAddress, strasse: "" }).success, false);
    assert.equal(FLAddressSchema.safeParse({ ...validAddress, stadt: "" }).success, false);
    assert.equal(FLAddressSchema.safeParse({ ...validAddress, stadtteil: "" }).success, true);
  });
});

describe("FLAddressPayloadSchema", () => {
  // The filler is per field rather than shared: `hausnummer` has an alphabet, so an `x` would prove
  // the pattern refusing a long value and leave the ceiling itself untested.
  const capped = [
    { field: "strasse", cap: ADDRESS_STRASSE_MAX_LENGTH, filler: "x" },
    { field: "stadt", cap: ADDRESS_STADT_MAX_LENGTH, filler: "x" },
    { field: "stadtteil", cap: ADDRESS_STADTTEIL_MAX_LENGTH, filler: "x" },
    { field: "hausnummer", cap: ADDRESS_HAUSNUMMER_MAX_LENGTH, filler: "1" },
  ] as const;

  it("accepts a value exactly at the cap and refuses the next character", () => {
    for (const { field, cap, filler } of capped) {
      const atTheCap = filler.repeat(cap);
      assert.equal(FLAddressPayloadSchema.safeParse({ ...validAddress, [field]: atTheCap }).success, true, `${field} at the cap`);
      assert.equal(FLAddressPayloadSchema.safeParse({ ...validAddress, [field]: atTheCap + filler }).success, false, `${field} over it`);
    }
  });

  it("keeps refusing an empty strasse or stadt, which redeclaring the field could have dropped", () => {
    for (const field of ["strasse", "stadt"] as const) {
      assert.equal(FLAddressPayloadSchema.safeParse({ ...validAddress, [field]: "" }).success, false, `${field} empty`);
    }
  });

  // A venue can genuinely lack a house number or a district, so neither field carries a floor and a
  // redeclaration bounding its length must not turn it into a required one.
  it("keeps accepting an empty hausnummer or stadtteil", () => {
    for (const field of ["hausnummer", "stadtteil"] as const) {
      assert.equal(FLAddressPayloadSchema.safeParse({ ...validAddress, [field]: "" }).success, true, `${field} empty`);
    }
  });

  // Nothing else would catch the loss: a pattern is outside what `fl_frontend/src/core/apiContract.test.ts` compares.
  it("keeps refusing a hausnummer outside its alphabet, which redeclaring the field could have dropped", () => {
    for (const hausnummer of ["12d", "12 a", "Nr. 12"]) {
      assert.equal(FLAddressPayloadSchema.safeParse({ ...validAddress, hausnummer }).success, false, `expected "${hausnummer}" to be rejected`);
    }
  });

  // The load-bearing half: the read schema parses whatever is stored, so one over-long row cannot
  // fail the list it appears in.
  it("leaves the read schema accepting a stored value the payload refuses", () => {
    for (const { field, cap, filler } of capped) {
      assert.equal(FLAddressSchema.safeParse({ ...validAddress, [field]: filler.repeat(cap + 1) }).success, true, `${field} over the cap`);
    }
  });
});

describe("FLKontaktSchema", () => {
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

  it("accepts common German phone formats", () => {
    for (const telefon of ["069123456", "+49 69 123456", "(069) 123-456", "+49-69-123456"]) {
      assert.equal(FLKontaktSchema.safeParse({ telefon, email: null }).success, true, `expected "${telefon}" to be accepted`);
    }
  });

  it("rejects phone numbers with letters, or shorter than 3 / longer than 20 characters", () => {
    for (const telefon of ["ab", "06", "069-ABC-123", "+4969123456789012345678"]) {
      assert.equal(FLKontaktSchema.safeParse({ telefon, email: null }).success, false, `expected "${telefon}" to be rejected`);
    }
  });

  // With `\s` inside `^...$` every one of these passed here and was refused by the API. Patterns are
  // out of the contract comparison, so a unit test is what holds the two spellings together.
  it("rejects a phone number carrying a control character, which the backend rejects too", () => {
    for (const telefon of ["+49 69 1234567\n", "\n\n1234567", "+49\t69\t1234567", "+49 69 1234567\r", "069123\n456"]) {
      assert.equal(FLKontaktSchema.safeParse({ telefon, email: null }).success, false, `expected ${JSON.stringify(telefon)} to be rejected`);
    }
  });

  // Both fields accept null (not supplied) and "" (supplied but cleared); the two are distinct
  // states in the admin forms, so both must stay valid.
  it("accepts null and empty string for both fields", () => {
    assert.equal(FLKontaktSchema.safeParse({ telefon: null, email: null }).success, true);
    assert.equal(FLKontaktSchema.safeParse({ telefon: "", email: "" }).success, true);
  });

  it("validates email addresses", () => {
    assert.equal(FLKontaktSchema.safeParse({ telefon: null, email: "info@frankfurtleague.de" }).success, true);
    for (const email of ["info@", "@frankfurtleague.de", "info frankfurtleague.de", "info@@x.de"]) {
      assert.equal(FLKontaktSchema.safeParse({ telefon: null, email }).success, false, `expected "${email}" to be rejected`);
    }
  });

  // The boundary, not a wildly long string: a bound set anywhere passes that. Past it the API answers
  // a bare REQ-VAL-001 carrying no field detail, so without this the box showed no error at all.
  it("accepts an address at the backend ceiling and refuses the next character, in German", () => {
    const atTheCap = addressOfLength(KONTAKT_EMAIL_MAX_LENGTH);
    assert.equal(atTheCap.length, KONTAKT_EMAIL_MAX_LENGTH);
    assert.equal(FLKontaktSchema.safeParse({ telefon: null, email: atTheCap }).success, true, "at the cap");

    const over = FLKontaktSchema.safeParse({ telefon: null, email: addressOfLength(KONTAKT_EMAIL_MAX_LENGTH + 1) });
    assert.equal(over.success, false, "one over the cap");
    // The union carries the message, so the ceiling must not have moved it to zod's own English.
    assert.deepEqual(
      over.error?.issues.map((issue) => issue.message),
      ["Bitte gib eine gültige E-Mail-Adresse ein."],
    );
  });

  // email-validator applies RFC 5321's 64-octet local-part cap only under `strict`, which pydantic
  // does not pass. A bound here alone would refuse in German an address the API stores.
  it("accepts a local part over 64 characters, which the backend accepts too", () => {
    assert.equal(FLKontaktSchema.safeParse({ telefon: null, email: `${"a".repeat(65)}@example.com` }).success, true);
  });

  it("rejects a missing field outright", () => {
    assert.equal(FLKontaktSchema.safeParse({ telefon: null }).success, false);
  });
});

describe("ExternalUrlSchema", () => {
  const USERINFO = [
    "https://frankfurtleague.de@evil.com",
    "https://frankfurtleague.de@evil.com/spenden",
    "http://frankfurtleague.de:geheim@evil.com",
    "https://user@frankfurtleague.de",
    // A password and no user at all, so neither half of the check stands in for the other.
    "https://:geheim@evil.com",
  ];
  const HARMLOS = ["https://www.carl-schurz-schule.de", "http://example.de", "https://a.b.example.de/pfad?q=1#top"];
  // The whole reason this schema exists: bare z.url() accepts every one of these.
  it("rejects the script-bearing schemes that z.url() lets through", () => {
    for (const url of ["javascript:alert(1)", "JavaScript:alert(1)", "data:text/html,<script>1</script>", "vbscript:x", "file:///etc/passwd"]) {
      assert.equal(ExternalUrlSchema.safeParse(url).success, false, `expected "${url}" to be rejected`);
      assert.equal(z.url().safeParse(url).success, true, `z.url() no longer accepts "${url}" — this test can be simplified`);
    }
  });

  it("accepts ordinary http and https links", () => {
    for (const url of HARMLOS) {
      assert.equal(ExternalUrlSchema.safeParse(url).success, true, `expected "${url}" to be accepted`);
    }
  });

  it("rejects a URL whose userinfo hides the host it reaches", () => {
    // Everything before the `@` is userinfo. The visible text names the league; the browser goes to evil.com.
    for (const url of USERINFO) {
      assert.equal(ExternalUrlSchema.safeParse(url).success, false, `expected "${url}" to be rejected`);
    }
  });

  it("accepts nothing that navigates anywhere but the host it displays", () => {
    // The property the case above samples: a listed spelling proves only that spelling, and userinfo
    // has more of them than a test can name.
    const accepted = [...USERINFO, ...HARMLOS].filter((url) => ExternalUrlSchema.safeParse(url).success);

    assert.deepEqual(accepted, HARMLOS, "the corpus proves nothing unless the harmless half still parses");
    for (const url of accepted) {
      assert.equal(new URL(url).username, "", `${url}: accepted while carrying a user`);
      assert.equal(new URL(url).password, "", `${url}: accepted while carrying a password`);
    }
  });

  it("rejects a hostname that is not a domain", () => {
    for (const url of ["https://ok", "https://localhost", "https://127.0.0.1"]) {
      assert.equal(ExternalUrlSchema.safeParse(url).success, false, `expected "${url}" to be rejected`);
    }
  });
});

describe("CustomTimeStringSchema", () => {
  it("accepts HH:MM:SS", () => {
    for (const t of ["00:00:00", "09:05:00", "14:30:00", "23:59:59"]) {
      assert.equal(CustomTimeStringSchema.safeParse(t).success, true, `expected ${t} to parse`);
    }
  });

  // `z.iso.time()` accepts both of these and the backend's `CustomTimeString` does not, so a
  // looser schema here lets the admin form submit a value the API answers with a 422.
  it("rejects a time without seconds, which the backend rejects too", () => {
    assert.equal(CustomTimeStringSchema.safeParse("14:30").success, false);
  });

  it("rejects fractional seconds, which the backend rejects too", () => {
    assert.equal(CustomTimeStringSchema.safeParse("14:30:00.5").success, false);
  });

  it("rejects out-of-range and malformed values", () => {
    for (const t of ["24:00:00", "14:60:00", "14:30:60", "2:30:00", "", "abc"]) {
      assert.equal(CustomTimeStringSchema.safeParse(t).success, false, `expected ${t} to be rejected`);
    }
  });
});
