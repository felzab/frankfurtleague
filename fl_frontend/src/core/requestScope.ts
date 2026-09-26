import { AsyncLocalStorage } from "node:async_hooks";

import { cache } from "react";

// Under `nginx/shared/site.conf :: proxy_read_timeout` by the proxy's session read before this scope
// opens. Next streams an action's answer once it returns, the re-render following in chunks, and nginx
// times each gap between reads, not the response (`docs/frontend/spec.md :: I366`).
export const REQUEST_DEADLINE_MS = 30000;

interface RequestScope {
  traceId: string;
  // This service's own span, minted per request: each hop mints one locally and only the trace id
  // travels end to end (`docs/logging/spec.md :: L12`).
  spanId: string;
  // Absent on a public read, and on an admin one until its session resolves.
  actor?: string;
  // On `performance.now()`'s clock rather than `Date.now()`'s, which a wall-clock step moves.
  deadlineAt: number;
  // Set where a call may have landed unanswered, which the spines read once the request's work is done.
  outcomeUnknown: boolean;
  // Set when a call that may write is dispatched, answered or not: the admin spine judges by it what its
  // answer leaves standing, where an action declaring it would repeat what each call already says.
  writeSent: boolean;
}

const storage = new AsyncLocalStorage<RequestScope>();

// React's per-request memo, a page's reads each opening a scope with no render-wide entry to anchor
// on. Outside a render it memoizes nothing, so an action's or route handler's outermost scope starts
// its request (`docs/frontend/spec.md :: I366`).
const scopeOfThisRender = cache((): { scope?: RequestScope } => ({}));

export function runWithRequestScope<T>(scope: Pick<RequestScope, "traceId" | "spanId" | "actor">, fn: () => Promise<T>): Promise<T> {
  // One request, one scope: a slice's read opens one inside the action awaiting it, and a scope of its
  // own there would restart the deadline and drop the actor the guard recorded.
  if (storage.getStore() !== undefined) return fn();

  const render = scopeOfThisRender();
  render.scope ??= { ...scope, deadlineAt: performance.now() + REQUEST_DEADLINE_MS, outcomeUnknown: false, writeSent: false };

  return storage.run(render.scope, fn);
}

/**
 * One outbound call's abort signal: its own bound, or what is left of the request's deadline where that
 * is shorter, and born aborted once nothing is left. Outside a scope, a `"use cache"` fill's, its own bound alone.
 */
export function boundCall(ownBoundMs: number): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController();
  const store = storage.getStore();
  const left = store === undefined ? Infinity : store.deadlineAt - performance.now();

  if (store !== undefined && left <= 0) {
    store.outcomeUnknown = true;
    controller.abort();

    return { signal: controller.signal, clear: () => {} };
  }

  // Marked only where the deadline fired: a call its own bound ended is answered by its own error.
  const byDeadline = left < ownBoundMs;
  const handle = setTimeout(
    () => {
      if (store !== undefined && byDeadline) store.outcomeUnknown = true;
      controller.abort();
    },
    Math.min(ownBoundMs, left),
  );

  return { signal: controller.signal, clear: () => clearTimeout(handle) };
}

/**
 * For a call whose failure a caller settles rather than throws, where it may still have landed: a mail
 * the provider may have accepted before the connection broke. A no-op outside a scope.
 */
export function markOutcomeUnknown(): void {
  const store = storage.getStore();
  if (store !== undefined) store.outcomeUnknown = true;
}

/**
 * Runs a call whose doubt its caller words in its own answer, so a deadline cut inside it never marks the request
 * (`docs/frontend/spec.md :: I366`). A write it sends still counts as sent. A no-op outside a scope.
 */
export async function runAnsweringOwnCut<T>(fn: () => Promise<T>): Promise<T> {
  const store = storage.getStore();
  if (store === undefined) return fn();

  // A scope of its own rather than the flag reset afterwards, which would also clear a cut of a call running beside it.
  const own: RequestScope = { ...store, outcomeUnknown: false };
  try {
    return await storage.run(own, fn);
  } finally {
    if (own.writeSent) store.writeSent = true;
  }
}

/** Whether the deadline cut a call of this request, or a settled call may have landed. `false` outside a scope. */
export function requestOutcomeUnknown(): boolean {
  return storage.getStore()?.outcomeUnknown === true;
}

/**
 * Called as a call that may write is sent: one never answered may still have landed. The API and mail
 * clients call it themselves, and a write through another client at the write. A no-op outside a scope.
 */
export function recordWriteSent(): void {
  const store = storage.getStore();
  if (store !== undefined) store.writeSent = true;
}

/** Whether this request has dispatched a call that may write. `false` outside a scope. */
export function requestWriteSent(): boolean {
  return storage.getStore()?.writeSent === true;
}

export function getRequestTraceId(): string | undefined {
  return storage.getStore()?.traceId;
}

export function getRequestSpanId(): string | undefined {
  return storage.getStore()?.spanId;
}

export function getRequestActor(): string | undefined {
  return storage.getStore()?.actor;
}

// Mutates the live store: the session resolves after the scope is entered, and `run()` seeds at
// entry alone. A no-op outside a scope, and on the address-less session the sign-in library's types
// admit but a mailed link cannot produce.
export function setRequestActor(actor: string | null | undefined): void {
  const store = storage.getStore();
  if (!store || !actor) return;

  // Two session guards ran on one request, which is a programming error rather than a shape to
  // serve: whichever landed last would name the actor of every write this request makes
  // (`docs/frontend/spec.md :: I272`).
  if (store.actor !== undefined && store.actor !== actor) throw new Error("A second actor was set on one request scope.");

  store.actor = actor;
}
