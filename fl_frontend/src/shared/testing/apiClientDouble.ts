import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { afterEach, beforeEach } from "node:test";

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

  // Sent through the real client's own dispatch, so the write the admin spine judges its answer by is
  // recorded here exactly as the real client records it.
  const source = `import { dispatchRequest, sentRequestOf } from "@/core/apiDispatch";
export const apiClient = async (endpoint, schema, options = {}) => {
  const call = { endpoint, method: options.method, body: options.body, params: options.params, headers: new Headers(options.headers), readOnly: options.readOnly };
  return dispatchRequest(sentRequestOf(options.method, options.readOnly), async () => {
    globalThis.${bus}.calls.push(call);
    return globalThis.${bus}.answer(call, schema);
  });
};`;

  registerHooks({
    load(url, context, nextLoad) {
      // Matched on the RESOLVED url, so this holds whichever order the alias hook and this one run in.
      return url.endsWith("/src/core/api.ts") ? { format: "module", source, shortCircuit: true } : nextLoad(url, context);
    },
  });

  return calls;
}

/** One request as the backend reads it, and whether the caller declared it a read. */
export type SentApiRequest = { endpoint: string; method: string | undefined; body: unknown; params?: unknown; readOnly?: true };

/**
 * The query and the read-only mark appear only where a call carried them, so a comparison naming
 * neither fails on a value leaked into a query, and on a write marked a read, which records no write.
 */
export const requestsOf = (calls: readonly ApiCall[]): SentApiRequest[] =>
  calls.map(({ endpoint, method, body, params, readOnly }) => ({
    endpoint,
    method,
    body: body === undefined ? undefined : (JSON.parse(body) as unknown),
    ...(params === undefined ? {} : { params }),
    ...(readOnly === true ? { readOnly } : {}),
  }));

/** What the backend answers one call with, handed the call so an answer can tell the requests apart. */
type ApiAnswer = (call: ApiCall) => Promise<unknown>;

/**
 * `doubleApiClient` answering every call with `answer`, until `answerWith` names another for the rest
 * of that case: the double a suite drives a slice's real `mutations.ts` through. Each answer passes
 * through the schema its caller handed, as a real response does.
 */
export function doubleApiAnswers(answer: ApiAnswer = () => Promise.resolve({ acknowledged: 1 })): {
  calls: ApiCall[];
  answerWith: (next: ApiAnswer) => void;
} {
  let answering = answer;
  const malformed: string[] = [];
  const calls = doubleApiClient(async (call, schema) => {
    const answered = await answering(call);
    try {
      return schema.parse(answered);
    } catch (error) {
      malformed.push(`${call.method ?? "GET"} ${call.endpoint}`);
      throw error;
    }
  });

  // Back to `answer` before every case: a case that named another would hand it to the next case's write.
  beforeEach(() => {
    answering = answer;
    calls.length = 0;
    malformed.length = 0;
  });
  // Judged after the case, not at the call: the action catches the parse's throw and may answer just
  // as the case expects of a real failure. A fixture error, never the client's malformed-data error.
  afterEach(() => {
    assert.deepEqual(malformed, [], "the case answered these calls with a body the real client refuses as malformed");
  });

  return { calls, answerWith: (next) => void (answering = next) };
}
