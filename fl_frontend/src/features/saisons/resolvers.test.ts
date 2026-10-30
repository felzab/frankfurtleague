import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveIsFinishedSaison, resolveSaisonId, selectSaison } from "./resolvers.ts";

import type { FLSaisonsListResponse } from "@/core/generated/client/types.ts";

/** How often the stand-in list was read, which is the whole of what the absent-id case is about. */
const reads = vi.hoisted(() => ({ count: 0 }));

// The season list the resolver reads, standing in for the cached public read.
vi.mock("./queries", () => {
  const getSaisons = async (): Promise<FLSaisonsListResponse> => {
    reads.count += 1;

    return {
      saisons: [
        { id: "2025", status: "past" },
        { id: "2026", status: "active" },
      ],
    } as unknown as FLSaisonsListResponse;
  };

  return { getSaisons, getAdminSaisons: getSaisons };
});

beforeEach(() => {
  reads.count = 0;
});

describe("whether a page shows a finished season", () => {
  /* The page without `?saison_id=` shows the running season, and `.claude/rules/frontend.md`'s
   **saisons** clause keeps the season list unread on exactly that path. */
  it("answers no for the running season without reading the season list", async () => {
    expect(await resolveIsFinishedSaison(undefined)).toBe(false);
    expect(reads.count, "the absent id read the season list").toBe(0);
  });

  it("reads a named season's status off the list", async () => {
    expect(await resolveIsFinishedSaison("2025")).toBe(true);
    expect(await resolveIsFinishedSaison("2026")).toBe(false);
  });
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
    await expect(resolveSaisonId(Promise.resolve({ saison_id: " 2026", gruppe: "A" }), "admin")).rejects.toSatisfy(
      (error) => redirectQuery(error) === "?gruppe=A",
    );
  });

  /* The redirect is a fresh request line and history entry, so an old search query a bookmark still
     holds stays behind. */
  it("leaves an old search query behind on the way back", async () => {
    await expect(resolveSaisonId(Promise.resolve({ saison_id: " 2026", q: "Lena", gruppe: "A" }), "admin")).rejects.toSatisfy(
      (error) => redirectQuery(error) === "?gruppe=A",
    );
  });
});
