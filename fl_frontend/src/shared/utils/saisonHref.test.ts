import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { withSaisonId } from "./saisonHref.ts";

describe("withSaisonId", () => {
  it("leaves a path alone where no season is in force", () => {
    assert.equal(withSaisonId("/bereich/admin/teams", null), "/bereich/admin/teams");
    assert.equal(withSaisonId("/bereich/admin/teams", undefined), "/bereich/admin/teams");
  });

  it("appends the season to a bare path", () => {
    assert.equal(withSaisonId("/bereich/admin/teams", "9999"), "/bereich/admin/teams?saison_id=9999");
  });

  it("amends a query rather than replacing it", () => {
    assert.equal(withSaisonId("/bereich/admin/spielsuche?team=abc", "9999"), "/bereich/admin/spielsuche?team=abc&saison_id=9999");
  });

  /* The subject's own season outranks the shell's: the club editor links at one stored membership, and
     overwriting it with whatever the selector showed would open a different season's row. */
  it("keeps a season the path already names", () => {
    assert.equal(withSaisonId("/bereich/admin/kontakte/abc?saison_id=2026", "9999"), "/bereich/admin/kontakte/abc?saison_id=2026");
  });

  it("encodes a season that would otherwise alter the query", () => {
    assert.equal(withSaisonId("/bereich/admin/teams", "a&b=c"), "/bereich/admin/teams?saison_id=a%26b%3Dc");
  });
});
