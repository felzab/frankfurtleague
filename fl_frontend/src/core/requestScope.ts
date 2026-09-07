import { AsyncLocalStorage } from "node:async_hooks";

interface RequestScope {
  traceId: string;
  // This service's own span, minted per request: each hop mints one locally and only the trace id
  // travels end to end (`docs/logging/spec.md :: L12`).
  spanId: string;
  // Absent on a public read, and on an admin one until its session resolves.
  actor?: string;
}

const storage = new AsyncLocalStorage<RequestScope>();

export function runWithRequestScope<T>(scope: RequestScope, fn: () => Promise<T>): Promise<T> {
  return storage.run(scope, fn);
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
// entry alone. A no-op outside a scope, and on the address-less session Auth.js's types admit but
// the Resend provider cannot produce.
export function setRequestActor(actor: string | null | undefined): void {
  const store = storage.getStore();
  if (store && actor) store.actor = actor;
}
