import { describe, expect, it } from "vitest";

import { withSaisonId } from "./saisonHref.ts";

describe("withSaisonId", () => {
  it("leaves a path alone where no season is in force", () => {
    expect(withSaisonId("/bereich/admin/teams", null)).toBe("/bereich/admin/teams");
    expect(withSaisonId("/bereich/admin/teams", undefined)).toBe("/bereich/admin/teams");
  });

  it("appends the season to a bare path", () => {
    expect(withSaisonId("/bereich/admin/teams", "9999")).toBe("/bereich/admin/teams?saison_id=9999");
  });

  it("amends a query rather than replacing it", () => {
    expect(withSaisonId("/bereich/admin/spielsuche?team=abc", "9999")).toBe("/bereich/admin/spielsuche?team=abc&saison_id=9999");
  });

  /* The subject's own season outranks the shell's: the club editor links at one stored membership, and
     overwriting it with whatever the selector showed would open a different season's row. */
  it("keeps a season the path already names", () => {
    expect(withSaisonId("/bereich/admin/kontakte/abc?saison_id=2026", "9999")).toBe("/bereich/admin/kontakte/abc?saison_id=2026");
  });

  it("encodes a season that would otherwise alter the query", () => {
    expect(withSaisonId("/bereich/admin/teams", "a&b=c")).toBe("/bereich/admin/teams?saison_id=a%26b%3Dc");
  });
});
