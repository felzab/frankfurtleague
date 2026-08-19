import { AsyncLocalStorage } from "node:async_hooks";

interface RequestScope {
  correlationId: string;
}

const storage = new AsyncLocalStorage<RequestScope>();

export function runWithRequestScope<T>(scope: RequestScope, fn: () => Promise<T>): Promise<T> {
  return storage.run(scope, fn);
}

export function getRequestCorrelationId(): string | undefined {
  return storage.getStore()?.correlationId;
}
