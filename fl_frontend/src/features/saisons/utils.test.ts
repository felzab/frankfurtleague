import assert from "node:assert/strict";
import { describe, it } from "node:test";

// Relative import, not the "@/" alias: Node's resolver does not read tsconfig paths.
import { buildSpieltagBound, describeSpielplanUmfang, searchWithoutSaisonId } from "./utils.ts";

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

describe("describeSpielplanUmfang", () => {
  // One group of two with both qualifying: a group fixture and a final. The generator writes nothing
  // smaller, so no count below this reaches the phrase from a real season.
  it("counts the smallest draw the rules allow", () => {
    assert.equal(describeSpielplanUmfang(2, 2), "2 Spieltage und 2 Spiele");
  });

  it("counts a season-sized draw", () => {
    assert.equal(describeSpielplanUmfang(12, 96), "12 Spieltage und 96 Spiele");
  });

  // The singular branch, covered because the code has it rather than because a season reaches it:
  // the counts are the server's, and a fixed plural would report a 1 as "1 Spieltage".
  it("spells a count of one in the singular, which no season draws but the server could send", () => {
    assert.equal(describeSpielplanUmfang(1, 1), "ein Spieltag und ein Spiel");
    assert.equal(describeSpielplanUmfang(1, 6), "ein Spieltag und 6 Spiele");
  });
});

describe("buildSpieltagBound", () => {
  const spieltag = (beginn: string | null, ende: string | null) => ({ beginn, ende });

  it("bounds the season by the earliest beginn and the latest ende", () => {
    assert.deepEqual(
      buildSpieltagBound([spieltag("2025-10-04", "2025-10-05"), spieltag("2025-09-06", "2025-09-07"), spieltag("2025-11-01", "2025-11-02")]),
      { startMax: "2025-09-06", endMin: "2025-11-02" },
    );
  });

  it("binds neither end for a season holding no matchday", () => {
    assert.deepEqual(buildSpieltagBound([]), { startMax: null, endMin: null });
  });

  /* The generator's own output: every matchday of a drawn season is undated until somebody dates it,
     and a bound of "" here is what `parseDate` throws on. */
  it("binds neither end when every matchday is undated", () => {
    assert.deepEqual(buildSpieltagBound([spieltag(null, null), spieltag(null, null)]), { startMax: null, endMin: null });
  });

  /* The regression: an unfiltered `sort()` stringifies null to "null", which sorts after every ISO
     date and takes the last position, so `endMin` came back as the undated row rather than October. */
  it("keeps the latest ende when a later matchday is still undated", () => {
    assert.deepEqual(buildSpieltagBound([spieltag("2025-09-06", "2025-09-07"), spieltag(null, null), spieltag("2025-10-04", "2025-10-05")]), {
      startMax: "2025-09-06",
      endMin: "2025-10-05",
    });
  });

  it("derives each end on its own, a matchday being able to carry one date and not the other", () => {
    assert.deepEqual(buildSpieltagBound([spieltag("2025-09-06", null), spieltag(null, "2025-10-05")]), {
      startMax: "2025-09-06",
      endMin: "2025-10-05",
    });
  });

  it("binds only the end a dated matchday reaches", () => {
    assert.deepEqual(buildSpieltagBound([spieltag(null, "2025-10-05")]), { startMax: null, endMin: "2025-10-05" });
  });
});
