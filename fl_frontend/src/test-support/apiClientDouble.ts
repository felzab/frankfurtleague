import { answersInFlight } from "@/test-support/answersInFlight.ts";
import { afterEach, beforeEach, expect, vi } from "vitest";

import { dispatchRequest, sentRequestOf } from "@/core/apiDispatch.ts";

import type * as Api from "@/core/api.ts";
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

/**
 * A response schema an answer is parsed through where the case wants its shape held. A generated call hands none, and
 * stands under `ANSWERED_AS_IS`.
 */
export type ApiSchema = { parse: (value: unknown) => unknown };

/** What a generated call's answer passes through: nothing, as the real `sendToBackend` parses nothing. */
const ANSWERED_AS_IS: ApiSchema = { parse: (value) => value };

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
 * Stands in for `fl_frontend/src/core/api.ts :: sendToBackend`, which every generated call reaches through
 * `core/transport.ts`, recording every call and answering each with what `answer` returns or throws.
 * Called before the caller's `await import`: `vi.doMock` reaches only the modules imported after it. The module's other
 * exports stay the real ones (Vitest's `importOriginal` partial mock), so the transport's path and query helpers run as
 * they do in production, and no call reaches the real backend.
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
  // A generated call: its query is already in `endpoint`, and its tier is the operation's own.
  const sendToBackend = (endpoint: string, options: ApiOptions = {}): Promise<unknown> => apiClient(endpoint, ANSWERED_AS_IS, options);
  vi.doMock("@/core/api.ts", async (importOriginal) => ({
    ...(await importOriginal<typeof Api>()),
    sendToBackend,
  }));

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
 * of that case: the double a suite drives a slice's real `mutations.ts` through. Each answer passes through the schema
 * its caller handed.
 */
export function doubleApiAnswers(answer: ApiAnswer = () => Promise.resolve({})): {
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
