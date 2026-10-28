import { answersInFlight } from "@/test-support/answersInFlight.ts";
import { afterEach, beforeEach, expect, vi } from "vitest";

import { dispatchRequest, sentRequestOf } from "@/core/apiDispatch.ts";

import type { FetchOptions } from "@/core/api.ts";

/** One request a module handed the backend client: the path, and what it went with. */
export type ApiCall = {
  endpoint: string;
  method: string | undefined;
  body: string | undefined;
  params: unknown;
  headers: Headers;
  readOnly: boolean | undefined;
  /** As the caller named it, `undefined` being the client's own default, a base-tier call. */
  authType: FetchOptions["authType"];
};

/** The response schema the caller handed the client, which an answer is parsed through where the case wants its shape held. */
export type ApiSchema = { parse: (value: unknown) => unknown };

/** What a caller hands the client beside the endpoint and the schema. */
type ApiOptions = {
  method?: string;
  body?: string;
  params?: unknown;
  headers?: HeadersInit;
  readOnly?: boolean;
  authType?: FetchOptions["authType"];
};

/**
 * Stands in for `fl_frontend/src/core/api.ts`'s `apiClient`, recording every call and answering each
 * with what `answer` returns or throws. Called before the caller's `await import`: `vi.doMock` reaches
 * only the modules imported after it. The real module is never loaded, so a subject reaching any other
 * export of it fails on Vitest's missing-export error rather than running against the real backend.
 */
export function doubleApiClient(answer: (call: ApiCall, schema: ApiSchema) => unknown): ApiCall[] {
  const calls: ApiCall[] = [];

  // Sent through the real client's own dispatch, so the write the admin spine judges its answer by is
  // recorded here exactly as the real client records it.
  const apiClient = async (endpoint: string, schema: ApiSchema, options: ApiOptions = {}): Promise<unknown> => {
    const call: ApiCall = {
      endpoint,
      method: options.method,
      body: options.body,
      params: options.params,
      headers: new Headers(options.headers),
      readOnly: options.readOnly,
      authType: options.authType,
    };
    return dispatchRequest(sentRequestOf(options.method, options.readOnly), async () => {
      calls.push(call);
      return answer(call, schema);
    });
  };
  vi.doMock("@/core/api.ts", () => ({ apiClient }));

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
  /** Awaited before reading what a case's answers set off, so every answer has landed. */
  answered: () => Promise<void>;
} {
  let answering = answer;
  const malformed: string[] = [];
  const requests = answersInFlight();
  const parsed = async (call: ApiCall, schema: ApiSchema): Promise<unknown> => {
    const answered = await answering(call);
    try {
      return schema.parse(answered);
    } catch (error) {
      malformed.push(`${call.method ?? "GET"} ${call.endpoint}`);
      throw error;
    }
  };
  const calls = doubleApiClient((call, schema) => requests.track(`${call.method ?? "GET"} ${call.endpoint}`, parsed(call, schema)));

  // Back to `answer` before every case: a case that named another would hand it to the next case's write.
  beforeEach(() => {
    answering = answer;
    calls.length = 0;
    malformed.length = 0;
  });
  // Judged after the case, not at the call: the action catches the parse's throw and may answer just
  // as the case expects of a real failure. A fixture error, never the client's malformed-data error.
  afterEach(() => {
    expect(malformed, "the case answered these calls with a body the real client refuses as malformed").toStrictEqual([]);
  });

  return {
    calls,
    answerWith: (next) => void (answering = next),
    answered: requests.answered,
  };
}
