// Imported rather than global: a case's mocked clock holds the globals, and would hold the wait with them.
import { setImmediate as nextTurn, setTimeout as wallClock } from "node:timers/promises";

import { refusalStatus } from "@/test-support/refusals.ts";
import { TEST_ENVIRONMENT } from "@/test-support/testEnvironment.mts";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, assert, beforeEach } from "vitest";

import type { Code, FLRefusedField } from "@/core/generated/client/types.ts";
import type { AnyHandler } from "msw";

/**
 * Where the backend is served: the address the runner's environment hands the real `fl_frontend/src/core/config.ts`,
 * so a request the code under test sends arrives here.
 */
export const BACKEND_ORIGIN = TEST_ENVIRONMENT.API_URL;

/**
 * The path every endpoint is spelled under, spelled rather than imported from `fl_frontend/src/core/api.ts`: importing
 * the client here would load it, and the config it binds, ahead of a suite's own doubles. A renamed base path leaves
 * every request unanswered, which fails every case.
 */
const BASE_PATH = "/api/v0";

/** One request as the backend read it: the endpoint below the base path, still percent-encoded, and what it carried. */
type BackendRequest = {
  method: string;
  path: string;
  search: URLSearchParams;
  headers: Headers;
  /** The JSON body parsed, the text where it is none, and `undefined` where the request carried none. */
  body: unknown;
};

/**
 * What the backend answers one request with: a body answered `200` as JSON, or a `Response` itself, a `refusal` or
 * `HttpResponse.error()` for a backend that never answers among them. `undefined` answers nothing, which fails the case.
 */
type BackendAnswer = (request: BackendRequest) => unknown;

/**
 * Bounded, so a case awaiting an answer nobody gives fails naming it, rather than hanging until the runner cancels
 * its file naming nothing.
 */
const ANSWER_WAIT_MS = 2_000;

/** What one file's backend holds. Every file runs in a module registry of its own, so no file sees another's. */
type FileBackend = {
  sent: BackendRequest[];
  initial: BackendAnswer | undefined;
  answering: BackendAnswer | undefined;
  /** Answers that stand in every case ahead of the case's own, each passing a request it leaves `undefined` on. */
  standing: BackendAnswer[];
  /** Answers consulted only where the case's own answer leaves a request `undefined`, or the file names none. */
  fallbacks: BackendAnswer[];
  /** What went wrong out of the code's sight: a request nothing answered, or an answer that threw. */
  faults: string[];
  inFlight: Set<string>;
  /** Serves another host's handlers for the rest of a case. */
  use: (...handlers: AnyHandler[]) => void;
};

let fileBackend: FileBackend | undefined;

const labelOf = ({ method, path, search }: BackendRequest): string => `${method} ${path}${search.size > 0 ? `?${search.toString()}` : ""}`;

async function backendRequestOf(request: Request): Promise<BackendRequest> {
  const url = new URL(request.url);
  const text = await request.text();
  let body: unknown = undefined;
  if (text !== "") {
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      body = text;
    }
  }

  return { method: request.method, path: url.pathname.slice(BASE_PATH.length), search: url.searchParams, headers: request.headers, body };
}

const responseOf = (answer: unknown): Response =>
  answer instanceof Response ? answer : new Response(JSON.stringify(answer), { status: 200, headers: { "content-type": "application/json" } });

/** The answer to one request, standing answers first; a request nothing answers is a fault and a failed request. */
async function answerOf(backend: FileBackend, request: BackendRequest): Promise<Response> {
  const label = labelOf(request);
  try {
    for (const stand of backend.standing) {
      const answer = await stand(request);
      if (answer !== undefined) return responseOf(answer);
    }

    backend.sent.push(request);
    const answer = backend.answering === undefined ? undefined : await backend.answering(request);
    if (answer !== undefined) return responseOf(answer);

    for (const fallback of backend.fallbacks) {
      const answered = await fallback(request);
      if (answered !== undefined) return responseOf(answered);
    }
    backend.faults.push(`nothing answered ${label}`);
  } catch (error) {
    backend.faults.push(`the answer to ${label} threw: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
  }

  return HttpResponse.error();
}

/** Waits until no request is in flight, read again after a turn, which waits for a request an answer set off. */
async function untilAnswered(inFlight: Set<string>): Promise<void> {
  const lapse = new AbortController();
  const lapsed = wallClock(ANSWER_WAIT_MS, true, { signal: lapse.signal, ref: false }).catch(() => false);
  try {
    do {
      const turned = nextTurn().then(() => false);
      if (await Promise.race([turned, lapsed])) {
        assert.fail(`still unanswered after ${String(ANSWER_WAIT_MS)} ms: ${[...inFlight].join(", ")}`);
      }
    } while (inFlight.size > 0);
  } finally {
    lapse.abort();
  }
}

/** The file's one backend, its interception started on the first call, so a suite's own later `fetch` stub still wins. */
function theBackend(): FileBackend {
  if (fileBackend !== undefined) return fileBackend;
  const backend: FileBackend = {
    sent: [],
    initial: undefined,
    answering: undefined,
    standing: [],
    fallbacks: [],
    faults: [],
    inFlight: new Set(),
    use: () => undefined,
  };
  fileBackend = backend;

  const server = setupServer(
    http.all(`${BACKEND_ORIGIN}${BASE_PATH}/*`, async ({ request }) => {
      const read = await backendRequestOf(request);
      const label = labelOf(read);
      backend.inFlight.add(label);
      try {
        return await answerOf(backend, read);
      } finally {
        backend.inFlight.delete(label);
      }
    }),
  );
  // At the call rather than in a hook: a suite stubbing `fetch` itself after this call keeps its own stub.
  server.listen({
    // MSW intercepts Node's `http.request` beside `fetch`, so it meets the container engine's API too, which the
    // database tier's harness reaches over the engine's socket, spelled `http://localhost` with no port: that request
    // passes on to the engine unanswered. Any other host is a request of the code under test no case answered,
    // Cloudflare's or the mail provider's unless a case serves it: refused rather than let through, and recorded, since
    // the code may read the refusal as an outage and pass (https://mswjs.io/docs/api/setup-server/listen).
    onUnhandledRequest: (request, print) => {
      const url = new URL(request.url);
      if (url.protocol === "http:" && url.hostname === "localhost" && url.port === "") return;

      backend.faults.push(`no handler serves ${request.method} ${request.url}`);
      print.error();
      // The printed error alone lets the request through to the host: thrown, it is answered with MSW's own 500 and
      // never sent.
      throw new Error(`no handler serves ${request.method} ${request.url}`);
    },
  });
  backend.use = (...handlers) => {
    server.use(...handlers);
  };

  beforeEach(() => {
    backend.sent.length = 0;
    backend.faults.length = 0;
    backend.answering = backend.initial;
  });
  afterEach(() => {
    server.resetHandlers();
    const faults = backend.faults.splice(0);
    assert(faults.length === 0, `the backend saw what no case answered:\n${faults.join("\n")}`);
  });
  afterAll(() => {
    server.close();
  });

  return backend;
}

/**
 * Answers every later request with `stand` ahead of the case's own answer, in every case of the file: the sign-in
 * store's lookups and mails, which `fl_frontend/src/test-support/authDoubles.ts` answers. A request it leaves
 * `undefined` goes on to the case's answer; one it answers is not in `sent`.
 */
export function answerInEveryCase(stand: BackendAnswer): void {
  theBackend().standing.push(stand);
}

/**
 * Answers every later request the case's own answer leaves `undefined`, or every request where the file names no
 * answer, in every case of the file: a default a suite answering the backend itself replaces.
 */
export function answerWhereUnanswered(fallback: BackendAnswer): void {
  theBackend().fallbacks.push(fallback);
}

/** The file's backend as a case reads and steers it. */
export type Backend = {
  /** Every request the case's answer was handed since the case began, in order. */
  readonly sent: readonly BackendRequest[];
  /** Answers every request with `next` for the rest of the case. */
  answerWith: (next: BackendAnswer) => void;
  /** Awaited before reading what a case's requests set off, so every request sent has been answered. */
  answered: () => Promise<void>;
  /** Serves another host's requests, Cloudflare's or the mail provider's, for the rest of the case. */
  use: (...handlers: AnyHandler[]) => void;
};

/**
 * Serves `${API_URL}/api/v0/*` through Mock Service Worker for this file, as Vitest's own guide recommends for a request
 * (https://vitest.dev/guide/mocking/requests): the real client, transport and generated calls run, and only the network
 * beneath them is answered. Every request reaches `answer` until `answerWith` names another for the rest of a case, and
 * a request nothing answers, an answer that throws, or a request to any other host fails the case it was sent in.
 */
export function serveBackend(answer?: BackendAnswer): Backend {
  const backend = theBackend();
  if (answer !== undefined) {
    assert(backend.initial === undefined, "the file's backend already answers: one serveBackend with an answer per file");
    backend.initial = answer;
    backend.answering = answer;
  }

  return {
    sent: backend.sent,
    answerWith: (next) => void (backend.answering = next),
    answered: () => untilAnswered(backend.inFlight),
    use: (...handlers) => {
      backend.use(...handlers);
    },
  };
}

/**
 * The backend's failure body for `code`, or for none, as a response: the network's twin of
 * `fl_frontend/src/test-support/refusals.ts :: refused`, at the status that file names for each code.
 */
export function refusal(
  code: Code | undefined,
  { status = refusalStatus(code), fields = [] }: { status?: number; fields?: readonly FLRefusedField[] } = {},
): Response {
  // Without a code where none is named, so the client reads none, as it reads a code the contract does not publish.
  const body = { ...(code === undefined ? {} : { error_code: code }), fields, trace_id: "0" };

  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
