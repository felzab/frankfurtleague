import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { z } from "zod";

import { ExternalUrlSchema, FLAddressSchema, FLKontaktSchema } from "./schemas.ts";

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
