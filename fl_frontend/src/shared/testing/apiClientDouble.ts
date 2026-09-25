import { registerHooks } from "node:module";
import { beforeEach } from "node:test";

/** One request a module handed the backend client: the path, and what it went with. */
export type ApiCall = {
  endpoint: string;
  method: string | undefined;
  body: string | undefined;
  params: unknown;
  headers: Headers;
  readOnly: boolean | undefined;
};

/** The response schema the caller handed the client, which an answer is parsed through where the case wants its shape held. */
export type ApiSchema = { parse: (value: unknown) => unknown };

let registered = 0;

/**
 * Replaces `fl_frontend/src/core/api.ts` at the module boundary, recording every call and answering
 * each with what `answer` returns or throws. Registered before the caller's `await import`, whose
 * graph reaches the real client.
 */
export function doubleApiClient(answer: (call: ApiCall, schema: ApiSchema) => unknown): ApiCall[] {
  const calls: ApiCall[] = [];
  // Through a global: the replaced module is compiled from source and shares nothing with this scope.
  const bus = `__flApiClientDouble${String((registered += 1))}`;
  Reflect.set(globalThis, bus, { calls, answer });

  // The record the real client makes as it sends a write, which the admin spine judges its answer by.
  const source = `import { mayHaveWritten } from "@/core/errors";
import { recordWriteSent } from "@/core/requestScope";
export const apiClient = async (endpoint, schema, options = {}) => {
  if (mayHaveWritten({ method: (options.method ?? "GET").toUpperCase(), readOnly: options.readOnly === true })) recordWriteSent();
  const call = { endpoint, method: options.method, body: options.body, params: options.params, headers: new Headers(options.headers), readOnly: options.readOnly };
  globalThis.${bus}.calls.push(call);
  return globalThis.${bus}.answer(call, schema);
};`;

  registerHooks({
    load(url, context, nextLoad) {
      // Matched on the RESOLVED url, so this holds whichever order the alias hook and this one run in.
      return url.endsWith("/src/core/api.ts") ? { format: "module", source, shortCircuit: true } : nextLoad(url, context);
    },
  });

  return calls;
}

/** Each request as the backend reads it: the path, the method, and the body parsed. */
export const requestsOf = (calls: readonly ApiCall[]): { endpoint: string; method: string | undefined; body: unknown }[] =>
  calls.map(({ endpoint, method, body }) => ({ endpoint, method, body: body === undefined ? undefined : (JSON.parse(body) as unknown) }));

/**
 * `doubleApiClient` answering every call with `answer`, until `answerWith` names another for the rest
 * of that case: the double a suite drives a slice's real `mutations.ts` through.
 */
export function doubleApiAnswers(answer: () => Promise<unknown> = () => Promise.resolve({ acknowledged: 1 })): {
  calls: ApiCall[];
  answerWith: (next: () => Promise<unknown>) => void;
} {
  let answering = answer;
  // Back to `answer` before every case: a case that named another would hand it to the next case's write.
  beforeEach(() => void (answering = answer));

  return { calls: doubleApiClient(() => answering()), answerWith: (next) => void (answering = next) };
}
