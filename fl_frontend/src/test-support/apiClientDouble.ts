import { answersInFlight } from "@/test-support/answersInFlight.ts";
import { beforeEach, vi } from "vitest";

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

/** What a caller hands the client beside the endpoint. */
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
 * `core/transport.ts`, recording every call and answering each with what `answer` returns or throws, unparsed, as the
 * real `sendToBackend` parses nothing.
 * Called before the caller's `await import`: `vi.doMock` reaches only the modules imported after it. The module's other
 * exports stay the real ones (Vitest's `importOriginal` partial mock), so the transport's path and query helpers run as
 * they do in production, and no call reaches the real backend.
 */
export function doubleApiClient(answer: (call: ApiCall) => unknown): ApiCall[] {
  const calls: ApiCall[] = [];

  // Sent through the real client's own dispatch, so the write the admin spine judges its answer by is
  // recorded here exactly as the real client records it. A generated call's query is already in `endpoint`, and its tier
  // is the operation's own.
  const sendToBackend = async (endpoint: string, options: ApiOptions = {}): Promise<unknown> => {
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
      return answer(call);
    });
  };
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
 * of that case: the double a suite drives a slice's real `mutations.ts` through.
 */
export function doubleApiAnswers(answer: ApiAnswer = () => Promise.resolve({})): {
  calls: ApiCall[];
  answerWith: (next: ApiAnswer) => void;
  /** Awaited before reading what a case's answers set off, so every answer has landed. */
  answered: () => Promise<void>;
} {
  let answering = answer;
  const requests = answersInFlight();
  const calls = doubleApiClient((call) => requests.track(`${call.method ?? "GET"} ${call.endpoint}`, answering(call)));

  // Back to `answer` before every case: a case that named another would hand it to the next case's write.
  beforeEach(() => {
    answering = answer;
    calls.length = 0;
  });

  return {
    calls,
    answerWith: (next) => void (answering = next),
    answered: requests.answered,
  };
}
