import { describe, expect, it } from "vitest";

import { withSaisonId } from "./saisonHref.ts";

describe("withSaisonId", () => {
  it("leaves a path alone where no season is in force", () => {
    expect(withSaisonId("/area/team/teams", null)).toBe("/area/team/teams");
    expect(withSaisonId("/area/team/teams", undefined)).toBe("/area/team/teams");
  });

  it("appends the season to a bare path", () => {
    expect(withSaisonId("/area/team/teams", "9999")).toBe("/area/team/teams?saison_id=9999");
  });

  it("amends a query rather than replacing it", () => {
    expect(withSaisonId("/area/team/spielsuche?team=abc", "9999")).toBe("/area/team/spielsuche?team=abc&saison_id=9999");
  });

  /* The subject's own season outranks the shell's: the club editor links at one stored membership, and
     overwriting it with whatever the selector showed would open a different season's row. */
  it("keeps a season the path already names", () => {
    expect(withSaisonId("/area/team/kontakte/abc?saison_id=2026", "9999")).toBe("/area/team/kontakte/abc?saison_id=2026");
  });

  it("encodes a season that would otherwise alter the query", () => {
    expect(withSaisonId("/area/team/teams", "a&b=c")).toBe("/area/team/teams?saison_id=a%26b%3Dc");
  });
});
