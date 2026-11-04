import { AsyncLocalStorage } from "node:async_hooks";

import { cache } from "react";

import type { AuthFactor } from "./auth/sessionStamps";

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
 * Who the request acts for, as `fl_frontend/src/core/api.ts :: sendToBackend` states them beside the admin
 * key: the folded address, when its session was made in whole seconds, and by which factor
 * (`fl_frontend/src/core/auth/guards.ts :: requestActorOf`).
 */
export type RequestActor = { readonly email: string; readonly lane: ActorLane; readonly authTime: number; readonly factor: AuthFactor };

interface RequestScope {
  traceId: string;
  // Absent on a public read, and on an admin one until its session resolves.
  actor?: RequestActor;
  // On `performance.now()`'s clock rather than `Date.now()`'s, which a wall-clock step moves.
  deadlineAt: number;
  // The writes sent that may stand, each counted as it is sent and taken back once its own answer refuses it: the
  // action builder clears the site's cache tag by it, where an action declaring its writes would repeat what each call
  // already says. Held by reference, so the scope `runAnsweringOwnCut` derives counts into it.
  standing: { writes: number };
  // Redesign: the two flags below go with the write-outcome functions further down, and so do the lines that seed
  // them in each scope and set `outcomeUnknown` in `boundCall`.
  // Set as a write is sent, whatever its answer, which the old write path's spines judge a throw by.
  writeSent: boolean;
  // Set where a call may have landed unanswered, which the spines read once the request's work is done.
  outcomeUnknown: boolean;
  // `oncePerRequest`'s reads, by the function each wraps. Held by reference, so the scope
  // `runAnsweringOwnCut` derives shares it.
  memo: Map<() => Promise<unknown>, Promise<unknown>>;
  // Set on a background pass's scope, the scheduler's and the Postausgang's drain: its writes are drained by the pass
  // itself, never behind a response it has not got.
  background: boolean;
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
    standing: { writes: 0 },
    outcomeUnknown: false,
    writeSent: false,
    memo: new Map(),
    background: false,
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
    standing: { writes: 0 },
    outcomeUnknown: false,
    writeSent: false,
    memo: new Map(),
    background: false,
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  // Settled at the deadline whatever the work still awaits: a sign-in store call is bounded by its own
  // `timeoutMS` and never by this scope, and a stopping server waits on this promise, not the work.
  const cut = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, AFTER_RESPONSE_DEADLINE_MS);
  });

  return Promise.race([storage.run(scope, work), cut]).finally(() => clearTimeout(timer));
}

/**
 * Runs a background pass, the scheduler's or the Postausgang's drain, under its trace and no deadline: each call it sends
 * is bounded by its own bound alone, and a pass a stopping container cuts leaves what it held to the next. The writes
 * it sends drain nothing behind a response (`fl_frontend/src/core/api.ts :: sendToBackend`): the pass drains its own.
 */
export function runInBackground<T>(traceId: string, pass: () => Promise<T>): Promise<T> {
  const scope: RequestScope = {
    traceId,
    deadlineAt: Infinity,
    standing: { writes: 0 },
    outcomeUnknown: false,
    writeSent: false,
    memo: new Map(),
    background: true,
  };

  return storage.run(scope, pass);
}

/** Whether this call runs inside a background pass. */
export function inBackground(): boolean {
  return storage.getStore()?.background === true;
}

/** What is left of the request's deadline: unbounded outside a scope, where a cache fill and a timer's pass run. */
export function requestTimeLeft(): number {
  const store = storage.getStore();

  return store === undefined ? Infinity : store.deadlineAt - performance.now();
}

/**
 * One outbound call's abort signal: its own bound, or what is left of the request's deadline where that is nearer, and
 * aborted from the start once nothing is left. Outside a scope, a `"use cache"` fill's, its own bound alone. Either way
 * it aborts with a `TimeoutError`, as `AbortSignal.timeout` does
 * (https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal/timeout_static); one timer of the nearer bound is the
 * signal `AbortSignal.any` would make of the two.
 */
export function boundCall(ownBoundMs: number): AbortSignal {
  const store = storage.getStore();
  const left = requestTimeLeft();

  if (store !== undefined && left <= 0) {
    store.outcomeUnknown = true;

    return AbortSignal.abort(new DOMException("The request's deadline had passed.", "TimeoutError"));
  }
  if (store === undefined || ownBoundMs <= left) return AbortSignal.timeout(ownBoundMs);

  const signal = AbortSignal.timeout(left);
  // Marked only where the deadline is the nearer bound: a call its own bound ended is answered by its own error. One
  // answered before the deadline is marked as it passes all the same, which only work outliving the deadline reads.
  signal.addEventListener(
    "abort",
    () => {
      store.outcomeUnknown = true;
    },
    { once: true },
  );

  return signal;
}

/**
 * Records a write as it is sent, counted as standing until its own answer refuses it: one never answered may still
 * have landed. Answers the withdrawal, which takes that one write back and no other. Its one caller is
 * `fl_frontend/src/core/apiDispatch.ts :: dispatchRequest`, for every write the generated client sends. A write
 * through the sign-in store's own client is recorded by none: it moves nothing a cached read serves, so recorded it
 * would clear the site's cache tag for nothing, and an action changing that store calls Next's `refresh()` itself.
 * A no-op outside a scope.
 */
export function recordWriteSent(): () => void {
  const store = storage.getStore();
  if (store === undefined) return () => undefined;

  store.writeSent = true;
  store.standing.writes += 1;
  return () => {
    store.standing.writes -= 1;
  };
}

/** Whether a write this request sent may stand: sent, and not refused by its own answer. `false` outside a scope. */
export function requestWriteMayStand(): boolean {
  return (storage.getStore()?.standing.writes ?? 0) > 0;
}

// Redesign: the write-outcome functions below go with their last importers, the old write path's spines and the
// slices' old actions and mails. The builder in `fl_frontend/src/core/action.ts` reads none of them.

/** Whether the transport has sent a write of this request, refused or not. `false` outside a scope. */
export function requestWriteSent(): boolean {
  return storage.getStore()?.writeSent === true;
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
  }
}

/** Whether the deadline cut a call of this request. `false` outside a scope. */
export function requestOutcomeUnknown(): boolean {
  return storage.getStore()?.outcomeUnknown === true;
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
