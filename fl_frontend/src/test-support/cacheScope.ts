import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { assert, expect, it, vi } from "vitest";

/** One render pass's memo table, and the handle React reaches it through. */
type CacheDispatcher = { getCacheForType: <T>(create: () => T) => T };

type ServerReact = {
  cache: <A extends unknown[], R>(fn: (...args: A) => R) => (...args: A) => R;
  __SERVER_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE: { A: CacheDispatcher | null };
};

const FRONTEND_DIR = path.resolve(import.meta.dirname, "..", "..");

/** Rooted at the frontend manifest, so a caller's own depth never reaches a dependency lookup. */
const requireFromFrontend = createRequire(path.join(FRONTEND_DIR, "package.json"));

// Loaded by path because a test resolves `react` without `react-server`, whose build is the real
// memoizer: the client build's `cache` is a passthrough, so every count would read unmemoized and
// blame the source.
const REACT_DIR = path.dirname(requireFromFrontend.resolve("react/package.json"));
const SERVER_REACT_URL = pathToFileURL(path.join(REACT_DIR, "react.react-server.js")).href;

const serverReact = (await import(/* @vite-ignore */ SERVER_REACT_URL)) as unknown as ServerReact;
const internals = serverReact.__SERVER_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
assert(internals, "the react-server build no longer exposes its internals -- this harness needs a new way to open a cache scope");

/** `null` outside a render pass, where every call gets a table of its own. */
let memoTable: Map<unknown, unknown> | null = new Map<unknown, unknown>();
internals.A = {
  getCacheForType: <T>(create: () => T): T => {
    // As Next's dispatcher answers a server action or a route handler, which run outside a render:
    // `getCacheForType` finds no request there and hands each call a new map.
    if (memoTable === null) return create();
    if (!memoTable.has(create)) memoTable.set(create, create());
    return memoTable.get(create) as T;
  },
};

/** Next installs one of these per request, so a fresh table here is the next request arriving. */
export function beginRenderPass(): void {
  memoTable = new Map();
}

/** What a server action's body or a route handler meets: React's `cache` memoizing nothing. */
export function leaveRenderPass(): void {
  memoTable = null;
}

/**
 * Answers `react` with the server build to every application module the suite imports after this
 * call. Packages under `node_modules`, Next's client runtime among them, are loaded by Node itself and
 * keep the client build, which they need.
 */
export function serveServerReact(): void {
  vi.doMock("react", () => serverReact);
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

    expect(wrapped, "the scope is not memoizing -- `cache` here is the client build's passthrough").toBe(1);
    expect(bare, "an unwrapped call is being counted as memoized, so the counter proves nothing").toBe(2);
  });
}
