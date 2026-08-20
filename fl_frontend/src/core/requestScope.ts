import { AsyncLocalStorage } from "node:async_hooks";

interface RequestScope {
  correlationId: string;
  // Absent on a public read, and on an admin one until its session resolves.
  actor?: string;
}

const storage = new AsyncLocalStorage<RequestScope>();

export function runWithRequestScope<T>(scope: RequestScope, fn: () => Promise<T>): Promise<T> {
  return storage.run(scope, fn);
}

export function getRequestCorrelationId(): string | undefined {
  return storage.getStore()?.correlationId;
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
