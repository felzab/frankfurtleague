import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { it } from "node:test";
import { pathToFileURL } from "node:url";

/** One render pass's memo table, and the handle React reaches it through. */
type CacheDispatcher = { getCacheForType: <T>(create: () => T) => T };

type ServerReact = {
  cache: <A extends unknown[], R>(fn: (...args: A) => R) => (...args: A) => R;
  __SERVER_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE: { A: CacheDispatcher | null };
};

const FRONTEND_DIR = path.resolve(import.meta.dirname, "..", "..", "..");

/** Rooted at the frontend manifest, so a caller's own depth never reaches a dependency lookup. */
export const requireFromFrontend = createRequire(path.join(FRONTEND_DIR, "package.json"));

// Loaded by path because `node --test` resolves `react` without `react-server`, whose build is the
// real memoizer: the client build's `cache` is a passthrough, so every count would read unmemoized
// and blame the source.
const REACT_DIR = path.dirname(requireFromFrontend.resolve("react/package.json"));
export const SERVER_REACT_URL = pathToFileURL(path.join(REACT_DIR, "react.react-server.js")).href;

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
export function beginRenderPass(): void {
  memoTable = new Map();
}

export function itOpensAScopeThatMemoizes(): void {
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
}
