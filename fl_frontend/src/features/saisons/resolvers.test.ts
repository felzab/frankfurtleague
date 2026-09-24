import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { before, beforeEach, describe, it } from "node:test";

/* For its resolver alone: `next` publishes no `exports` map, and the harness supplies the extension
   `next/navigation` is written without. */
import "@/shared/testing/renderTest.ts";

// Type-only, so nothing is imported at load: the resolver is pulled in from `before`, below.
import type {
  resolveIsFinishedSaison as resolveIsFinishedSaisonFunction,
  resolveSaisonId as resolveSaisonIdFunction,
  selectSaison as selectSaisonFunction,
} from "./resolvers.ts";
import type { FLSaisonsListResponse } from "./schemas.ts";

/** How often the stand-in list was read, which is the whole of what the absent-id case is about. */
let reads = 0;

/** The season list the resolver reads, standing in for the cached public read. */
export async function getSaisons(): Promise<FLSaisonsListResponse> {
  reads += 1;

  return {
    saisons: [
      { id: "2025", status: "past" },
      { id: "2026", status: "active" },
    ],
  } as unknown as FLSaisonsListResponse;
}

export const getAdminSaisons = getSaisons;

registerHooks({
  resolve(specifier, context, nextResolve) {
    // Narrowed to the resolver, so nothing else loaded here loses the real queries module.
    if ((context.parentURL ?? "").endsWith("/resolvers.ts") && specifier === "./queries") {
      return { url: import.meta.url, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

let resolveIsFinishedSaison!: typeof resolveIsFinishedSaisonFunction;
let resolveSaisonId!: typeof resolveSaisonIdFunction;
let selectSaison!: typeof selectSaisonFunction;

before(async () => {
  ({ resolveIsFinishedSaison, resolveSaisonId, selectSaison } = await import("./resolvers.ts"));
});

beforeEach(() => {
  reads = 0;
});

describe("whether a page shows a finished season", () => {
  /* The page without `?saison_id=` shows the running season, and `.claude/rules/frontend.md`'s
   **saisons** clause keeps the season list unread on exactly that path. */
  it("answers no for the running season without reading the season list", async () => {
    assert.equal(await resolveIsFinishedSaison(undefined), false);
    assert.equal(reads, 0, "the absent id read the season list");
  });

  it("reads a named season's status off the list", async () => {
    assert.equal(await resolveIsFinishedSaison("2025"), true);
    assert.equal(await resolveIsFinishedSaison("2026"), false);
  });
});

/* The order `SaisonSelector` resolves the header's season in, which every admin page's season must
   match (`docs/frontend/spec.md :: I359`). */
describe("which season a page addresses", () => {
  const PAST = { id: "2025", status: "past" } as const;
  const ACTIVE = { id: "2026", status: "active" } as const;
  const PLANNED = { id: "2027", status: "future" } as const;

  it("takes the one the address names, planned or not", () => {
    assert.equal(selectSaison([PAST, ACTIVE, PLANNED], "2027"), PLANNED);
  });

  it("takes the running one where the address names none", () => {
    assert.equal(selectSaison([PAST, ACTIVE, PLANNED], undefined), ACTIVE);
  });

  /* Before a league's first activation: the running season alone would leave every page empty. */
  it("takes the list's first where none runs", () => {
    assert.equal(selectSaison([PLANNED, { id: "2028", status: "future" }], undefined), PLANNED);
  });

  it("takes none where the league holds none, or the address names a season the list lacks", () => {
    assert.equal(selectSaison([], undefined), undefined);
    assert.equal(selectSaison([PAST, ACTIVE], "2027"), undefined);
  });
});

describe("which season an address names", () => {
  /* `SaisonSelector` matches the raw parameter, so an id only a trim finds would name a season on the
     page and none in the header. */
  it("strips a padded id rather than trimming it", async () => {
    await assert.rejects(resolveSaisonId(Promise.resolve({ saison_id: " 2026", q: "x" }), "admin"), (error: unknown) => {
      assert.equal((error as { digest?: string }).digest?.split(";")[2], "?q=x");
      return true;
    });
  });
});
