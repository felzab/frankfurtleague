import assert from "node:assert/strict";
import { createRequire, registerHooks } from "node:module";
import path from "node:path";
import { describe, it } from "node:test";
import { pathToFileURL } from "node:url";

const FRONTEND_DIR = path.resolve(import.meta.dirname, "..", "..", "..");
const requireFrom = createRequire(path.join(FRONTEND_DIR, "package.json"));

/** One render pass's memo table, and the handle React reaches it through. */
type CacheDispatcher = { getCacheForType: <T>(create: () => T) => T };

type ServerReact = {
  cache: <A extends unknown[], R>(fn: (...args: A) => R) => (...args: A) => R;
  __SERVER_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE: { A: CacheDispatcher | null };
};

// Loaded by path because `node --test` resolves `react` without `react-server`, whose build is the real memoizer.
const REACT_DIR = path.dirname(requireFrom.resolve("react/package.json"));
const SERVER_REACT_URL = pathToFileURL(path.join(REACT_DIR, "react.react-server.js")).href;

/** The three filtered admin reads under test, whose `react` imports the server build must answer. */
const FEATURE_URLS = ["spiele", "spieltage", "teams"].map((feature) => `${pathToFileURL(path.join(import.meta.dirname, "..", feature)).href}/`);

/** Stands in for `next/headers`, whose `headers()` needs a request context no test process has. */
const HEADERS_DOUBLE_URL = `data:text/javascript,${encodeURIComponent("export const headers = async () => new Headers();")}`;

/** Every request the doubled client was asked for, cumulative across every pass in this file. */
const reads: string[] = [];
const RECORDER = "__flAdminSeasonContentReads";
(globalThis as unknown as Record<string, string[]>)[RECORDER] = reads;

// The PARAMS ride on the recorded key, not just the path: what is under test is whether two calls
// naming the same filters share one round trip, which a path-only recorder could not tell apart.
const API_DOUBLE = `export const apiClient = async (endpoint, _schema, options) => {
  globalThis.${RECORDER}.push(endpoint + " " + JSON.stringify(options?.params ?? {}));
  return { format: "list", teams: [], spiele: [], spieltage: [] };
};`;

// Extensionless, not an exports-map subpath: only CJS resolution adds one. Up here: `require.resolve` re-enters the hook.
const NEXT_CACHE_URL = pathToFileURL(requireFrom.resolve("next/cache")).href;

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

const serverReact = (await import(SERVER_REACT_URL)) as unknown as ServerReact;
const internals = serverReact.__SERVER_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
assert.ok(internals, "the react-server build no longer exposes its internals -- this harness needs a new way to open a cache scope");

let memoTable = new Map<unknown, unknown>();
internals.A = {
  getCacheForType: <T>(create: () => T): T => {
    if (!memoTable.has(create)) memoTable.set(create, create());
    return memoTable.get(create) as T;
  },
};

/** Next installs one of these per request, so a fresh table here is the next request arriving. */
function beginRenderPass(): void {
  memoTable = new Map();
}

const { getAdminSpiele } = await import("./queries.ts");
const { getAdminSpieltage } = await import("../spieltage/queries.ts");
const { getAdminTeams } = await import("../teams/queries.ts");

const SAISON_ID = "2526";

const countOf = (endpoint: string): number => reads.filter((read) => read.startsWith(endpoint)).length;

/** The three counts together, so a per-endpoint delta needs no index into a parallel array. */
const countsNow = (): Map<string, number> => new Map(ENDPOINTS.map((endpoint) => [endpoint, countOf(endpoint)]));

const ENDPOINTS = ["/spiele/list/admin", "/spieltage/list/admin", "/teams/list/admin"];

/** All three reads, each given a FRESHLY BUILT filter object -- what a page does on every call. */
const readAllThree = async (): Promise<unknown[]> =>
  Promise.all([getAdminSpiele({ saison_id: SAISON_ID }), getAdminSpieltage({ saison_id: SAISON_ID }), getAdminTeams({ saison_id: SAISON_ID })]);

describe("the filtered admin reads across a render pass", () => {
  /* First, so a scope that failed to take fails here rather than under every count below. */
  it("opens a scope that memoizes, and shows the miss when nothing memoizes", () => {
    beginRenderPass();
    let wrapped = 0;
    let bare = 0;
    const readWrapped = serverReact.cache(() => (wrapped += 1));
    const readBare = (): number => (bare += 1);

    readWrapped();
    readWrapped();
    readBare();
    readBare();

    assert.equal(wrapped, 1, "the scope is not memoizing -- `cache` here is the client build's passthrough");
    assert.equal(bare, 2, "an unwrapped call is being counted as memoized, so the counter proves nothing");
  });

  it("each goes to the backend once when two boundaries ask the same season", async () => {
    beginRenderPass();
    const before = countsNow();

    // Two boundaries of one page, each writing its own object literal: keyed on identity these
    // would be two different arguments and every read below would count twice.
    await readAllThree();
    await readAllThree();

    for (const [endpoint, count] of before) {
      assert.equal(countOf(endpoint) - count, 1, `${endpoint} went to the backend twice in one render pass`);
    }
  });

  it("separates two filter sets, so a narrowed read is never served the whole season", async () => {
    beginRenderPass();
    const before = countOf("/spiele/list/admin");

    // The season editor's own three fixture reads: same season, three different questions.
    await Promise.all([
      getAdminSpiele({ saison_id: SAISON_ID }),
      getAdminSpiele({ saison_id: SAISON_ID, saison_phase: "playoffs" }),
      getAdminSpiele({ saison_id: SAISON_ID, saison_phase: "gruppenphase" }),
    ]);

    assert.equal(countOf("/spiele/list/admin") - before, 3, "two different filter sets shared one answer");
  });

  it("keys on the filters rather than the order they are written in", async () => {
    beginRenderPass();
    const before = countOf("/spieltage/list/admin");

    await Promise.all([
      getAdminSpieltage({ saison_id: SAISON_ID, saison_phase: "playoffs" }),
      getAdminSpieltage({ saison_phase: "playoffs", saison_id: SAISON_ID }),
    ]);

    assert.equal(countOf("/spieltage/list/admin") - before, 1, "the same filters written in another order paid for a second round trip");
  });

  it("is fetched again in the next pass, so no request is served another's copy", async () => {
    // Primed here rather than leaning on the tests above: a leak is only visible against a pass that
    // already read, and `it` order is not something this should depend on.
    beginRenderPass();
    await readAllThree();
    const before = countsNow();

    beginRenderPass();
    await readAllThree();
    await readAllThree();

    // Split, so each way of being wrong names itself: 0 is the cross-request leak `"use cache"`
    // would open on these reads, and 2 is no memoization at all.
    for (const [endpoint, count] of before) {
      const fetched = countOf(endpoint) - count;
      assert.notEqual(fetched, 0, `a new request was served the previous request's answer for ${endpoint}`);
      assert.equal(fetched, 1, `${endpoint} went to the backend twice in one render pass`);
    }
  });
});
