/**
 * SAISONS · derivation tests
 *
 * Covers the redirect target alone. What it pins is the shape a Server Component hands to
 * `redirect()` when `?saison_id=` names no season: the value is consumed by Next twice, once as a
 * client-router href and once as a `<meta http-equiv="refresh">` URL, and both resolve it against the
 * current document — so an empty result and a lost sibling parameter are the two ways it can be wrong.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

// Relative import, not the "@/" alias: Node's resolver does not read tsconfig paths.
import { searchWithoutSaisonId } from "./utils.ts";

describe("searchWithoutSaisonId", () => {
  it("returns a bare ? when the season was the only parameter", () => {
    // Not the empty string: an empty `Location` names no resource. `?` resolves to the same path, and
    // `URL.search` is "" for it, so the router's canonical href carries no trailing question mark.
    assert.equal(searchWithoutSaisonId({ saison_id: "2027" }), "?");
  });

  it("returns a bare ? for an empty query", () => {
    assert.equal(searchWithoutSaisonId({}), "?");
  });

  it("keeps every other parameter", () => {
    assert.equal(searchWithoutSaisonId({ saison_id: "2027", suche: "eintracht", sort_by: "name" }), "?suche=eintracht&sort_by=name");
  });

  it("keeps a repeated parameter's every value", () => {
    assert.equal(searchWithoutSaisonId({ saison_id: "2027", gruppe: ["a", "b"] }), "?gruppe=a&gruppe=b");
  });

  it("drops an undefined value rather than serialising it", () => {
    assert.equal(searchWithoutSaisonId({ saison_id: "2027", suche: undefined, sort_by: "name" }), "?sort_by=name");
  });

  it("percent-encodes what it keeps", () => {
    // The value goes into a URL Next resolves, so a space or an ampersand left raw would either be
    // dropped or would invent a second parameter.
    assert.equal(searchWithoutSaisonId({ saison_id: "2027", suche: "sv 07 & co" }), "?suche=sv+07+%26+co");
  });

  it("strips a repeated saison_id too", () => {
    // `?saison_id=2025&saison_id=2026` reaches the resolver as an array, which no season id matches.
    assert.equal(searchWithoutSaisonId({ saison_id: ["2025", "2026"], suche: "x" }), "?suche=x");
  });
});
