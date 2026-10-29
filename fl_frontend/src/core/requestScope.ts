import { AsyncLocalStorage } from "node:async_hooks";

import { cache } from "react";

import type { AuthFactor } from "./auth";

// Under `nginx/shared/site.conf :: proxy_read_timeout` by the proxy's session read before this scope
// opens. Next streams an action's answer once it returns, the re-render following in chunks, and nginx
// times each gap between reads, not the response.
export const REQUEST_DEADLINE_MS = 30000;

/**
 * As long as a request's own, counted from when `runBehindTheResponse` starts: its work is a request's half
 * moved behind the answer, sending the same calls. A stopping container waits out both.
 */
export const AFTER_RESPONSE_DEADLINE_MS = 30000;

/** Which guard recorded the actor: the administrator's, or a person's. */
export type ActorLane = "admin" | "person";

/**
 * Who the request acts for, as `fl_frontend/src/core/api.ts :: apiClient` states them beside the admin
 * key: the folded address, when its session was made in whole seconds, and by which factor
 * (`fl_frontend/src/core/auth.ts :: requestActorOf`).
 */
export type RequestActor = { readonly email: string; readonly lane: ActorLane; readonly authTime: number; readonly factor: AuthFactor };

interface RequestScope {
  traceId: string;
  // Absent on a public read, and on an admin one until its session resolves.
  actor?: RequestActor;
  // On `performance.now()`'s clock rather than `Date.now()`'s, which a wall-clock step moves.
  deadlineAt: number;
  // Redesign: the three flags below go with the write-outcome functions further down, and so do the lines that
  // seed them in each scope and set one in `boundCall`.
  // Set where a call may have landed unanswered, which the spines read once the request's work is done.
  outcomeUnknown: boolean;
  // Set when a call that may write is dispatched, answered or not: the admin spine judges by it what its
  // answer leaves standing, where an action declaring it would repeat what each call already says.
  writeSent: boolean;
  // Set before a write that may end the session the request carries: the spine then renders no page again.
  endsOwnSession: boolean;
  // `oncePerRequest`'s reads, by the function each wraps. Held by reference, so the scope
  // `runAnsweringOwnCut` derives shares it.
  memo: Map<() => Promise<unknown>, Promise<unknown>>;
}

const storage = new AsyncLocalStorage<RequestScope>();

// React's per-request memo, a page's reads each opening a scope with no render-wide entry to anchor
// on. Outside a render it memoizes nothing, so an action's or route handler's outermost scope starts
// its request.
const scopeOfThisRender = cache((): { scope?: RequestScope } => ({}));

export function runWithRequestScope<T>(scope: Pick<RequestScope, "traceId" | "actor">, fn: () => Promise<T>): Promise<T> {
  // One request, one scope: a slice's read opens one inside the action awaiting it, and a scope of its
  // own there would restart the deadline and drop the actor the guard recorded.
  if (storage.getStore() !== undefined) return fn();

  const render = scopeOfThisRender();
  render.scope ??= {
    ...scope,
    deadlineAt: performance.now() + REQUEST_DEADLINE_MS,
    outcomeUnknown: false,
    writeSent: false,
    endsOwnSession: false,
    memo: new Map(),
  };

  return storage.run(render.scope, fn);
}

/**
 * `fn` read once per request scope, and afresh outside one: React's `cache` keeps nothing in a server
 * action or a route handler. The render after an action opens a scope of its own, so it reads again.
 */
export function oncePerRequest<T>(fn: () => Promise<T>): () => Promise<T> {
  return () => {
    const store = storage.getStore();
    if (store === undefined) return fn();

    const held = store.memo.get(fn) as Promise<T> | undefined;
    if (held !== undefined) return held;

    const read = fn();
    store.memo.set(fn, read);
    return read;
  };
}

/**
 * Runs `work` behind a response, under a deadline of its own from `AFTER_RESPONSE_DEADLINE_MS`: the request's
 * would leave it only what the request did not use. It keeps the trace, no actor.
 */
export function runBehindTheResponse(traceId: string, work: () => Promise<void>): Promise<void> {
  const scope: RequestScope = {
    traceId,
    deadlineAt: performance.now() + AFTER_RESPONSE_DEADLINE_MS,
    outcomeUnknown: false,
    writeSent: false,
    endsOwnSession: false,
    memo: new Map(),
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  // Settled at the deadline whatever the work still awaits: a sign-in store call is bounded by its own
  // `timeoutMS` and never by this scope, and a stopping server waits on this promise, not the work.
  const cut = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, AFTER_RESPONSE_DEADLINE_MS);
  });

  return Promise.race([storage.run(scope, work), cut]).finally(() => clearTimeout(timer));
}

/** What is left of the request's deadline: unbounded outside a scope, where a cache fill and a timer's pass run. */
export function requestTimeLeft(): number {
  const store = storage.getStore();

  return store === undefined ? Infinity : store.deadlineAt - performance.now();
}

/**
 * One outbound call's abort signal: its own bound, or what is left of the request's deadline where that
 * is shorter, and born aborted once nothing is left. Outside a scope, a `"use cache"` fill's, its own bound alone.
 */
export function boundCall(ownBoundMs: number): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController();
  const store = storage.getStore();
  const left = requestTimeLeft();

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

// Redesign: the write-outcome functions below go with their last importers, the old write path's spines and the
// slices' old actions and mails. The builder in `fl_frontend/src/core/action.ts` clears the site's tag whatever a
// body came to and reads none of them.

/**
 * For a call whose failure a caller settles rather than throws, where it may still have landed: a mail
 * the provider may have accepted before the connection broke. A no-op outside a scope.
 */
export function markOutcomeUnknown(): void {
  const store = storage.getStore();
  if (store !== undefined) store.outcomeUnknown = true;
}

/**
 * Runs a call whose doubt its caller words in its own answer, so a deadline cut inside it never marks the request.
 * A write it sends still counts as sent. A no-op outside a scope.
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
    if (own.endsOwnSession) store.endsOwnSession = true;
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

/**
 * Called before a write that may end the session the request carries, answered or not: one never answered may
 * have ended it. A no-op outside a scope.
 */
export function recordOwnSessionEnding(): void {
  const store = storage.getStore();
  if (store !== undefined) store.endsOwnSession = true;
}

/** Whether this request sent a write that may have ended its own session. `false` outside a scope. */
export function requestEndsOwnSession(): boolean {
  return storage.getStore()?.endsOwnSession === true;
}

export function getRequestTraceId(): string | undefined {
  return storage.getStore()?.traceId;
}

export function getRequestActor(): RequestActor | undefined {
  return storage.getStore()?.actor;
}

// Mutates the live store: the session resolves after the scope is entered, and `run()` seeds at
// entry alone. A no-op outside a scope.
export function setRequestActor(actor: RequestActor): void {
  const store = storage.getStore();
  if (!store) return;

  // A second guard on one request is a programming error: whichever landed last would name every
  // write's actor. Compared by who and which lane, never by the
  // sign-in time or factor, which each guard reads off the one session.
  if (store.actor !== undefined && (store.actor.email !== actor.email || store.actor.lane !== actor.lane)) {
    throw new Error("A second actor was set on one request scope.");
  }

  // The first actor stands: a guard answering from its memo hands back the one it already built.
  store.actor ??= actor;
}
