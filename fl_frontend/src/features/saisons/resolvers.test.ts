import { describe, expect, it } from "vitest";

import { selectSaison } from "./resolvers.ts";

/* The season the admin frame and the header open on. */
describe("which season the frame defaults to", () => {
  const PAST = { id: "2025", status: "past" } as const;
  const ACTIVE = { id: "2026", status: "active" } as const;
  const PLANNED = { id: "2027", status: "future" } as const;

  it("takes the running one", () => {
    expect(selectSaison([PAST, ACTIVE, PLANNED])).toBe(ACTIVE);
  });

  /* Before a league's first activation: the running season alone would leave every page empty. */
  it("takes the list's first where none runs", () => {
    expect(selectSaison([PLANNED, { id: "2028", status: "future" }])).toBe(PLANNED);
  });

  it("takes none where the league holds none", () => {
    expect(selectSaison([])).toBe(undefined);
  });
});
