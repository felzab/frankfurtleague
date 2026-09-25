import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { describe, it } from "node:test";
import { pathToFileURL } from "node:url";

import { beginRenderPass, itOpensAScopeThatMemoizes, SERVER_REACT_URL } from "@/shared/testing/cacheScope.ts";

/** The saison modules under test, whose `react` imports are the ones the server build must answer. */
const FEATURE_URL = pathToFileURL(import.meta.dirname).href + "/";

/** Stands in for `next/headers`, whose `headers()` needs a request context no test process has. */
const HEADERS_DOUBLE_URL = `data:text/javascript,${encodeURIComponent("export const headers = async () => new Headers();")}`;

/** Endpoints the doubled client was asked for, cumulative across every pass in this file. */
const reads: string[] = [];
const RECORDER = "__flAdminSaisonReads";
(globalThis as unknown as Record<string, string[]>)[RECORDER] = reads;

// Replaced at the module boundary rather than the season code being reshaped to admit a seam: the
// real client reaches a backend no test process runs, at a base URL no test run holds.
const API_DOUBLE = `export const apiClient = async (endpoint) => {
  globalThis.${RECORDER}.push(endpoint);
  return { saisons: [{ id: "2526" }] };
};`;

registerHooks({
  resolve(specifier, context, nextResolve) {
    // Only for the modules under test: Next's client runtime is in this process and needs the client build.
    if (specifier === "react" && context.parentURL?.startsWith(FEATURE_URL)) return { url: SERVER_REACT_URL, shortCircuit: true };
    if (specifier === "next/headers") return { url: HEADERS_DOUBLE_URL, shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    // Matched on the RESOLVED url, so this holds whichever order the alias hook and this one run in.
    if (url.endsWith("/src/core/api.ts")) return { format: "module", source: API_DOUBLE, shortCircuit: true };
    return nextLoad(url, context);
  },
});

const { getAdminSaisons } = await import("./queries.ts");
const { resolveSaisonId } = await import("./resolvers.ts");

const adminReads = (): number => reads.filter((endpoint) => endpoint === "/saisons/list/admin").length;

describe("the admin season list across a render pass", () => {
  /* First, so a scope that failed to take fails here rather than under every count below. */
  itOpensAScopeThatMemoizes();

  it("is fetched once when the resolver and the page both read it", async () => {
    beginRenderPass();
    const before = adminReads();

    // What one admin Suspense boundary does: check the season named in the URL, then read the list.
    const resolved = await resolveSaisonId(Promise.resolve({ saison_id: "2526" }), "admin");
    await getAdminSaisons();

    assert.equal(resolved, "2526");
    assert.equal(adminReads() - before, 1, "the admin season list went to the backend twice in one render pass");
  });

  it("is fetched again in the next pass, so no request is served another's copy", async () => {
    // Primed here rather than leaning on the test above: a leak is only visible against a pass that
    // already read the list, and `it` order is not something this should depend on.
    beginRenderPass();
    await getAdminSaisons();
    const before = adminReads();

    beginRenderPass();
    await resolveSaisonId(Promise.resolve({ saison_id: "2526" }), "admin");
    await getAdminSaisons();

    // Split, so each way of being wrong names itself: 0 is the cross-request leak `"use cache"`
    // would open on this read, and 2 is no memoization at all.
    const fetched = adminReads() - before;
    assert.notEqual(fetched, 0, "a new request was served the previous request's admin list");
    assert.equal(fetched, 1, "the admin season list went to the backend twice in one render pass");
  });
});
