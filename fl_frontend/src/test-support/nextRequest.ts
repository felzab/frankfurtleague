// The classes Next's own `cookies()` reads and writes with, so the double parses and serialises as Next does.
import { RequestCookies, ResponseCookies } from "next/dist/server/web/spec-extension/cookies.js";

import { beforeEach, vi } from "vitest";

// Next's request-time functions answer only inside a request Next itself is serving, which no test runs in: a suite
// doubles them through `vi.doMock`, which reaches only the modules it imports after the call.

/** One invalidation a write made through `next/cache`: the export it called, and what it handed it. */
export type CacheCall = { name: string; args: unknown[] };

/** Every invalidation since the case began, `doubleNextRequest` emptying it before each case. */
export const cacheCalls: CacheCall[] = [];

const recorded = (names: readonly string[]): Record<string, (...args: unknown[]) => void> =>
  Object.fromEntries(
    names.map((name) => [
      name,
      (...args: unknown[]): void => {
        cacheCalls.push({ name, args });
      },
    ]),
  );

/**
 * `next/cache` as a server action meets it, every invalidation recorded into `cacheCalls`. `cacheLife` and `cacheTag`
 * declare a cached read rather than clear one, so they record nothing.
 */
export const NEXT_CACHE_DOUBLE = {
  ...recorded(["updateTag", "refresh", "revalidateTag", "revalidatePath"]),
  cacheLife: (): undefined => undefined,
  cacheTag: (): undefined => undefined,
};

/** The headers the doubled request arrived with: none, until `arriveWith` names some for the rest of the case. */
let incomingHeaders = new Headers();

/** What the response carries back to the browser: every cookie the request's code set or deleted. */
let responseHeaders = new Headers();

/**
 * The request's cookies as an action's or a route handler's `cookies()` hands them: read off the request, a cookie the
 * code set or deleted read as written, and every write carried on the response.
 */
function requestCookies() {
  const sent = new RequestCookies(incomingHeaders);
  const written = new ResponseCookies(responseHeaders);
  const store = {
    get: (name: string) => written.get(name) ?? sent.get(name),
    getAll: () => [...written.getAll(), ...sent.getAll().filter(({ name }) => !written.has(name))],
    has: (name: string) => written.has(name) || sent.has(name),
    set: (...args: Parameters<ResponseCookies["set"]>) => {
      written.set(...args);
      return store;
    },
    delete: (...args: Parameters<ResponseCookies["delete"]>) => {
      written.delete(...args);
      return store;
    },
  };

  return store;
}

/**
 * Every cookie the case's code set or deleted, as the response carries it back to the browser: read off its
 * `Set-Cookie` lines, a deleted cookie written empty and expired at the epoch, as Next deletes one.
 */
export const writtenCookies = (): ReturnType<ResponseCookies["getAll"]> => new ResponseCookies(responseHeaders).getAll();

/** `next/headers` for a request carrying what `arriveWith` set, its `cookies()` writing onto the response. */
export const NEXT_HEADERS_DOUBLE = {
  headers: () => Promise.resolve(new Headers(incomingHeaders)),
  cookies: () => Promise.resolve(requestCookies()),
};

/**
 * The request every later read of `next/headers` serves, for the rest of the case: a new visitor's, so no cookie the
 * code wrote for the one before it still answers.
 */
export function arriveWith(headers: HeadersInit): void {
  incomingHeaders = new Headers(headers);
  responseHeaders = new Headers();
}

/**
 * Doubles `next/headers` and `next/cache` for every module the suite imports after this call, each case arriving with
 * no headers, no cookie written and no invalidation recorded.
 */
export function doubleNextRequest(): void {
  beforeEach(() => {
    incomingHeaders = new Headers();
    responseHeaders = new Headers();
    cacheCalls.length = 0;
  });
  vi.doMock("next/headers", () => NEXT_HEADERS_DOUBLE);
  vi.doMock("next/cache", () => NEXT_CACHE_DOUBLE);
}
