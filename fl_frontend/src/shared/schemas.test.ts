import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { z } from "zod";

import {
  ADDRESS_STADT_MAX_LENGTH,
  ADDRESS_STRASSE_MAX_LENGTH,
  CustomTimeStringSchema,
  ExternalUrlSchema,
  FLAddressPayloadSchema,
  FLAddressSchema,
  FLKontaktSchema,
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
  const capped = [
    { field: "strasse", cap: ADDRESS_STRASSE_MAX_LENGTH },
    { field: "stadt", cap: ADDRESS_STADT_MAX_LENGTH },
  ] as const;

  it("accepts a value exactly at the cap and refuses the next character", () => {
    for (const { field, cap } of capped) {
      assert.equal(FLAddressPayloadSchema.safeParse({ ...validAddress, [field]: "x".repeat(cap) }).success, true, `${field} at the cap`);
      assert.equal(FLAddressPayloadSchema.safeParse({ ...validAddress, [field]: "x".repeat(cap + 1) }).success, false, `${field} over it`);
    }
  });

  it("keeps refusing an empty value, which redeclaring the field could have dropped", () => {
    for (const { field } of capped) {
      assert.equal(FLAddressPayloadSchema.safeParse({ ...validAddress, [field]: "" }).success, false, `${field} empty`);
    }
  });

  // The load-bearing half: the read schema parses whatever is stored, so one over-long row cannot
  // fail the list it appears in.
  it("leaves the read schema accepting a stored value the payload refuses", () => {
    for (const { field, cap } of capped) {
      assert.equal(FLAddressSchema.safeParse({ ...validAddress, [field]: "x".repeat(cap + 1) }).success, true, `${field} over the cap`);
    }
  });
});

describe("FLKontaktSchema", () => {
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

  it("rejects a missing field outright", () => {
    assert.equal(FLKontaktSchema.safeParse({ telefon: null }).success, false);
  });
});

describe("ExternalUrlSchema", () => {
  // The whole reason this schema exists: bare z.url() accepts every one of these.
  it("rejects the script-bearing schemes that z.url() lets through", () => {
    for (const url of ["javascript:alert(1)", "JavaScript:alert(1)", "data:text/html,<script>1</script>", "vbscript:x", "file:///etc/passwd"]) {
      assert.equal(ExternalUrlSchema.safeParse(url).success, false, `expected "${url}" to be rejected`);
      assert.equal(z.url().safeParse(url).success, true, `z.url() no longer accepts "${url}" — this test can be simplified`);
    }
  });

  it("accepts ordinary http and https links", () => {
    for (const url of ["https://www.carl-schurz-schule.de", "http://example.de", "https://a.b.example.de/pfad?q=1#top"]) {
      assert.equal(ExternalUrlSchema.safeParse(url).success, true, `expected "${url}" to be accepted`);
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
