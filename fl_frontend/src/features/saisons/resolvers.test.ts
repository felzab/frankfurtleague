import { describe, expect, it, vi } from "vitest";

import { resolveSaisonId, selectSaison } from "./resolvers.ts";

import type { FLSaisonsAdminListResponse } from "@/core/generated/client/types.ts";

// The season list the resolver reads, standing in for the admin read.
vi.mock("./queries", () => {
  const getAdminSaisons = async (): Promise<FLSaisonsAdminListResponse> =>
    ({
      saisons: [
        { id: "2025", status: "past" },
        { id: "2026", status: "active" },
      ],
    }) as unknown as FLSaisonsAdminListResponse;

  return { getAdminSaisons };
});

/* The order every admin page and the admin header's default resolve in. */
describe("which season a page addresses", () => {
  const PAST = { id: "2025", status: "past" } as const;
  const ACTIVE = { id: "2026", status: "active" } as const;
  const PLANNED = { id: "2027", status: "future" } as const;

  it("takes the one the address names, planned or not", () => {
    expect(selectSaison([PAST, ACTIVE, PLANNED], "2027")).toBe(PLANNED);
  });

  it("takes the running one where the address names none", () => {
    expect(selectSaison([PAST, ACTIVE, PLANNED], undefined)).toBe(ACTIVE);
  });

  /* Before a league's first activation: the running season alone would leave every page empty. */
  it("takes the list's first where none runs", () => {
    expect(selectSaison([PLANNED, { id: "2028", status: "future" }], undefined)).toBe(PLANNED);
  });

  it("takes none where the league holds none, or the address names a season the list lacks", () => {
    expect(selectSaison([], undefined)).toBe(undefined);
    expect(selectSaison([PAST, ACTIVE], "2027")).toBe(undefined);
  });
});

/** The query a redirect thrown by `next/navigation` sends the visitor to, read off its digest. */
const redirectQuery = (error: unknown): string | undefined => (error as { digest?: string }).digest?.split(";")[2];

describe("which season an address names", () => {
  /* `SaisonSelector` matches the raw parameter, so an id only a trim finds would name a season on the
     page and none in the header. */
  it("strips a padded id rather than trimming it", async () => {
    await expect(resolveSaisonId(Promise.resolve({ saison_id: " 2026", gruppe: "A" }))).rejects.toSatisfy(
      (error) => redirectQuery(error) === "?gruppe=A",
    );
  });

  /* The redirect is a fresh request line and history entry, so an old search query a bookmark still
     holds stays behind. */
  it("leaves an old search query behind on the way back", async () => {
    await expect(resolveSaisonId(Promise.resolve({ saison_id: " 2026", q: "Lena", gruppe: "A" }))).rejects.toSatisfy(
      (error) => redirectQuery(error) === "?gruppe=A",
    );
  });
});
