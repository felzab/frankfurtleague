import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import path from "node:path";
import { describe, it } from "node:test";
import { pathToFileURL } from "node:url";

import { beginRenderPass, itOpensAScopeThatMemoizes, requireFromFrontend, SERVER_REACT_URL } from "@/shared/testing/cacheScope.ts";

/** The two membership modules under test, whose `react` imports the server build must answer. */
const FEATURE_URLS = ["teams", "spieler"].map((feature) => `${pathToFileURL(path.join(import.meta.dirname, "..", feature)).href}/`);

/** Stands in for `next/headers`, whose `headers()` needs a request context no test process has. */
const HEADERS_DOUBLE_URL = `data:text/javascript,${encodeURIComponent("export const headers = async () => new Headers();")}`;

/** Endpoints the doubled client was asked for, cumulative across every pass in this file. */
const reads: string[] = [];
const RECORDER = "__flAdminMembershipReads";
(globalThis as unknown as Record<string, string[]>)[RECORDER] = reads;

// Replaced at the module boundary rather than the reads being reshaped to admit a seam: the real
// client reaches a backend no test process runs, at a base URL no test run holds.
const API_DOUBLE = `export const apiClient = async (endpoint) => {
  globalThis.${RECORDER}.push(endpoint);
  return { teams: [], spieler: [] };
};`;

// Extensionless, not an exports-map subpath: only CJS resolution adds one. Up here: `require.resolve` re-enters the hook.
const NEXT_CACHE_URL = pathToFileURL(requireFromFrontend.resolve("next/cache")).href;

const TEAMS_ENDPOINT = "/teams/memberships";
const SPIELER_ENDPOINT = "/spieler/memberships";

registerHooks({
  resolve(specifier, context, nextResolve) {
    // Only for the modules under test: Next's client runtime is in this process and needs the client build.
    const parent = context.parentURL;
    if (specifier === "react" && FEATURE_URLS.some((url) => parent?.startsWith(url))) return { url: SERVER_REACT_URL, shortCircuit: true };
    if (specifier === "next/headers") return { url: HEADERS_DOUBLE_URL, shortCircuit: true };
    if (specifier === "next/cache") return { url: NEXT_CACHE_URL, shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    // Matched on the RESOLVED url, so this holds whichever order the alias hook and this one run in.
    if (url.endsWith("/src/core/api.ts")) return { format: "module", source: API_DOUBLE, shortCircuit: true };
    return nextLoad(url, context);
  },
});

const { getTeamMemberships } = await import("./queries.ts");
const { getSpielerMemberships } = await import("../spieler/queries.ts");

const countOf = (endpoint: string): number => reads.filter((read) => read === endpoint).length;

describe("the admin membership lists across a render pass", () => {
  /* First, so a scope that failed to take fails here rather than under every count below. */
  itOpensAScopeThatMemoizes();

  it("is fetched once when both `/admin/teams` boundaries read the club list", async () => {
    beginRenderPass();
    const before = countOf(TEAMS_ENDPOINT);

    // What the create modal's boundary and the table's each do, and the shape that paid twice.
    await getTeamMemberships();
    await getTeamMemberships();

    assert.equal(countOf(TEAMS_ENDPOINT) - before, 1, "the admin club list went to the backend twice in one render pass");
  });

  it("is fetched once per list when both `/admin/spieler` boundaries read the pair", async () => {
    beginRenderPass();
    const beforeTeams = countOf(TEAMS_ENDPOINT);
    const beforeSpieler = countOf(SPIELER_ENDPOINT);

    // Both boundaries read both lists: a squad row names the club the create form also offers.
    await Promise.all([getTeamMemberships(), getSpielerMemberships()]);
    await Promise.all([getSpielerMemberships(), getTeamMemberships()]);

    assert.equal(countOf(TEAMS_ENDPOINT) - beforeTeams, 1, "the admin club list went to the backend twice in one render pass");
    assert.equal(countOf(SPIELER_ENDPOINT) - beforeSpieler, 1, "the admin player list went to the backend twice in one render pass");
  });

  it("is fetched again in the next pass, so no request is served another's copy", async () => {
    // Primed here rather than leaning on the tests above: a leak is only visible against a pass that
    // already read, and `it` order is not something this should depend on.
    beginRenderPass();
    await Promise.all([getTeamMemberships(), getSpielerMemberships()]);
    const beforeTeams = countOf(TEAMS_ENDPOINT);
    const beforeSpieler = countOf(SPIELER_ENDPOINT);

    beginRenderPass();
    await Promise.all([getTeamMemberships(), getSpielerMemberships()]);
    await Promise.all([getTeamMemberships(), getSpielerMemberships()]);

    // Split, so each way of being wrong names itself: 0 is the cross-request leak `"use cache"`
    // would open on these reads, and 2 is no memoization at all.
    const fetched: [string, number][] = [
      ["club", countOf(TEAMS_ENDPOINT) - beforeTeams],
      ["player", countOf(SPIELER_ENDPOINT) - beforeSpieler],
    ];
    for (const [list, count] of fetched) {
      assert.notEqual(count, 0, `a new request was served the previous request's admin ${list} list`);
      assert.equal(count, 1, `the admin ${list} list went to the backend twice in one render pass`);
    }
  });
});
