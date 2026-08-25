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

// `node --test` resolves `react` without the `react-server` condition, and that build's `cache` is
// a bare passthrough -- every count below would read unmemoized and blame the source.
const REACT_DIR = path.dirname(requireFrom.resolve("react/package.json"));
const SERVER_REACT_URL = pathToFileURL(path.join(REACT_DIR, "react.react-server.js")).href;

/** The saison modules under test, whose `react` imports are the ones the server build must answer. */
const FEATURE_URL = pathToFileURL(import.meta.dirname).href + "/";

/** Stands in for `next/headers`, whose `headers()` needs a request context no test process has. */
const HEADERS_DOUBLE_URL = `data:text/javascript,${encodeURIComponent("export const headers = async () => new Headers();")}`;

/** Endpoints the doubled client was asked for, cumulative across every pass in this file. */
const reads: string[] = [];
const RECORDER = "__flAdminSaisonReads";
(globalThis as unknown as Record<string, string[]>)[RECORDER] = reads;

// Replaced at the module boundary rather than the season code being reshaped to admit a seam: the
// real client imports `server-only` and validates the whole environment at import.
const API_DOUBLE = `export const apiClient = async (endpoint) => {
  globalThis.${RECORDER}.push(endpoint);
  return { saisons: [{ id: "2526" }] };
};`;

// Real modules, resolved through CJS: these are extensionless files, which Node's ESM resolver
// will not add an extension for and its CJS one will. Resolved up here, because `require.resolve`
// re-enters the hook below and would recurse without end.
const NEXT_MODULE_URLS = new Map(
  ["next/cache", "next/navigation"].map((specifier) => [specifier, pathToFileURL(requireFrom.resolve(specifier)).href]),
);

registerHooks({
  resolve(specifier, context, nextResolve) {
    // Only for the modules under test, which the real app compiles under that condition. Next's
    // client runtime is loaded into this process too and needs the client build's `createContext`.
    if (specifier === "react" && context.parentURL?.startsWith(FEATURE_URL)) return { url: SERVER_REACT_URL, shortCircuit: true };
    if (specifier === "next/headers") return { url: HEADERS_DOUBLE_URL, shortCircuit: true };
    const nextUrl = NEXT_MODULE_URLS.get(specifier);
    if (nextUrl) return { url: nextUrl, shortCircuit: true };
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

const { getAdminSaisons } = await import("./queries.ts");
const { resolveSaisonId } = await import("./resolvers.ts");

const adminReads = (): number => reads.filter((endpoint) => endpoint === "/saisons/list/admin").length;

describe("the admin season list across a render pass", () => {
  /* First, because a cache scope that failed to take would leave every count at its unmemoized
     value and each assertion after this would fail for the harness rather than for the code. */
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
