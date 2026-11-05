import { describe, expect, it } from "vitest";

// Relative import, not the "@/" alias: Node's resolver does not read tsconfig paths.
import { searchWithoutSaisonId } from "./utils.ts";

describe("searchWithoutSaisonId", () => {
  it("returns a bare ? when the season was the only parameter", () => {
    expect(searchWithoutSaisonId({ saison_id: "2027" })).toBe("?");
  });

  it("returns a bare ? for an empty query", () => {
    expect(searchWithoutSaisonId({})).toBe("?");
  });

  it("keeps every other parameter", () => {
    expect(searchWithoutSaisonId({ saison_id: "2027", suche: "eintracht", sort_by: "name" })).toBe("?suche=eintracht&sort_by=name");
  });

  it("keeps a repeated parameter's every value", () => {
    expect(searchWithoutSaisonId({ saison_id: "2027", gruppe: ["a", "b"] })).toBe("?gruppe=a&gruppe=b");
  });

  it("drops an undefined value rather than serialising it", () => {
    expect(searchWithoutSaisonId({ saison_id: "2027", suche: undefined, sort_by: "name" })).toBe("?sort_by=name");
  });

  it("percent-encodes what it keeps", () => {
    expect(searchWithoutSaisonId({ saison_id: "2027", suche: "sv 07 & co" })).toBe("?suche=sv+07+%26+co");
  });

  it("strips a repeated saison_id too", () => {
    // A repeated parameter reaches the resolver as an array, which no season id matches.
    expect(searchWithoutSaisonId({ saison_id: ["2025", "2026"], suche: "x" })).toBe("?suche=x");
  });
});
