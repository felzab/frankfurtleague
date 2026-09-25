import { AsyncLocalStorage } from "node:async_hooks";

// Under `nginx/shared/site.conf :: proxy_read_timeout` by what the same response spends outside this
// scope: the proxy's session read before it opens, and the page's re-render after it closes, whose
// reads keep their own bounds (`docs/frontend/spec.md :: I366`).
export const REQUEST_DEADLINE_MS = 30000;

interface RequestDeadline {
  // On `performance.now()`'s clock rather than `Date.now()`'s, which a wall-clock step moves.
  at: number;
  // Shared by reference with every scope opened inside this one, so the spine reads a cut made there.
  cut: boolean;
}

interface RequestScope {
  traceId: string;
  // This service's own span, minted per request: each hop mints one locally and only the trace id
  // travels end to end (`docs/logging/spec.md :: L12`).
  spanId: string;
  // Absent on a public read, and on an admin one until its session resolves.
  actor?: string;
  deadline: RequestDeadline;
}

const storage = new AsyncLocalStorage<RequestScope>();

export function runWithRequestScope<T>(scope: Omit<RequestScope, "deadline">, fn: () => Promise<T>): Promise<T> {
  // A scope opened inside another keeps its deadline: a slice's read opens one inside the action
  // awaiting it, and a fresh deadline there would let the chain outlast the edge.
  const deadline = storage.getStore()?.deadline ?? { at: performance.now() + REQUEST_DEADLINE_MS, cut: false };

  return storage.run({ ...scope, deadline: deadline }, fn);
}

/**
 * One outbound call's abort signal: its own bound, or what is left of the request's deadline where that
 * is shorter, and born aborted once nothing is left. Outside a scope, a `"use cache"` fill's, its own bound alone.
 */
export function boundCall(ownBoundMs: number): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController();
  const deadline = storage.getStore()?.deadline;
  const left = deadline === undefined ? Infinity : deadline.at - performance.now();

  if (deadline !== undefined && left <= 0) {
    deadline.cut = true;
    controller.abort();

    return { signal: controller.signal, clear: () => {} };
  }

  // Marked only where the deadline fired: a call its own bound ended says nothing about the request.
  const byDeadline = left < ownBoundMs;
  const handle = setTimeout(
    () => {
      if (deadline !== undefined && byDeadline) deadline.cut = true;
      controller.abort();
    },
    Math.min(ownBoundMs, left),
  );

  return { signal: controller.signal, clear: () => clearTimeout(handle) };
}

/** Whether the request's deadline refused or aborted any call it bounded. `false` outside a scope. */
export function requestDeadlineCut(): boolean {
  return storage.getStore()?.deadline.cut === true;
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
