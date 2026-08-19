import assert from "node:assert/strict";
import { describe, it } from "node:test";

// Relative import, not the "@/" alias: Node's resolver does not read tsconfig paths.
import { searchWithoutSaisonId } from "./utils.ts";

describe("searchWithoutSaisonId", () => {
  it("returns a bare ? when the season was the only parameter", () => {
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
    assert.equal(searchWithoutSaisonId({ saison_id: "2027", suche: "sv 07 & co" }), "?suche=sv+07+%26+co");
  });

  it("strips a repeated saison_id too", () => {
    // A repeated parameter reaches the resolver as an array, which no season id matches.
    assert.equal(searchWithoutSaisonId({ saison_id: ["2025", "2026"], suche: "x" }), "?suche=x");
  });
});
