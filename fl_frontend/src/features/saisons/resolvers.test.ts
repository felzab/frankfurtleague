import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { before, beforeEach, describe, it } from "node:test";

/* For its resolver alone: `next` publishes no `exports` map, and the harness supplies the extension
   `next/navigation` is written without. */
import "@/shared/testing/renderTest.ts";

// Type-only, so nothing is imported at load: the resolver is pulled in from `before`, below.
import type { resolveIsFinishedSaison as resolveIsFinishedSaisonFunction } from "./resolvers.ts";
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

before(async () => {
  resolveIsFinishedSaison = (await import("./resolvers.ts")).resolveIsFinishedSaison;
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
