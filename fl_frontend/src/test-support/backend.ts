/**
 * The network every test runs over: the global `fetch`, which our code reaches every host through, replaced from the
 * setup file by one that answers from the case and sends nothing. The real client, transport and generated calls
 * run, and only the network beneath them is answered.
 *
 * What a test file does:
 * - `serveBackend(answer)` at module level answers the backend at `BACKEND_ORIGIN/api/v0`. `answer` takes each request
 *   (the endpoint below the base path, its query, headers and parsed body) and returns a body, answered `200` as JSON,
 *   or a `Response`: `refusal(code)` for a refusal, `networkFailure()` for a backend that never answers. `undefined`
 *   answers nothing.
 * - A case reads `sent`, the requests its answer was handed, after awaiting `answered()`; `served` holds those the
 *   sign-in helpers' standing answers took. `answerWith` replaces the answer for the rest of a case.
 * - `serveHost(origin, answer)` answers another host, Cloudflare's or the mail provider's, through the same face, and
 *   returns the record of what it took: called at module level for the whole file, inside a case for its rest.
 *
 * What holds without a call, in every file of every project:
 * - Nothing leaves the machine: no request is ever sent. A request nothing answers, an answer that throws, and a
 *   request to a host no case serves fail the case that sent it, and the code meets a network failure.
 * - Every request is held from its call to its settlement: a case ends only once its requests have, two alike being
 *   two, and a fault raised before the first case or after a case ended fails the next case, or the file, naming
 *   where the request was sent.
 * - Each case begins with nothing recorded, the file's own answer, and only the file's hosts served.
 */
// Imported rather than global: a case's mocked clock holds the globals, and would hold the wait with them.
import { setImmediate as nextTurn, setTimeout as wallClock } from "node:timers/promises";

import { TEST_ENVIRONMENT } from "@/test-support/testEnvironment.mts";
import { afterAll, afterEach, assert, beforeEach } from "vitest";

import type { Code, FLRefusedField } from "@/core/generated/client/types.ts";

/**
 * Where the backend is served: the address the runner's environment hands the real `fl_frontend/src/core/config.ts`,
 * so a request the code under test sends arrives here.
 */
export const BACKEND_ORIGIN = TEST_ENVIRONMENT.API_URL;

/**
 * The path every endpoint is spelled under, spelled rather than imported from `fl_frontend/src/core/api.ts`: this
 * module loads from the setup file, ahead of every suite's doubles, and so imports no module of the application. A
 * renamed base path leaves every request unanswered, which fails every case.
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
 * `networkFailure()` among them. `undefined` answers nothing, which fails the case.
 */
type BackendAnswer = (request: BackendRequest) => unknown;

/** One request to another host, as `serveHost` records it: its whole address, and what it carried. */
type HostRequest = { method: string; url: URL; headers: Headers; body: unknown };

/** What another host answers one request with, as `BackendAnswer` does. */
type HostAnswer = (request: HostRequest) => unknown;

/** A host a file or a case serves: its answer, and every request it took. */
type Host = { answer: HostAnswer; taken: HostRequest[] };

/**
 * Bounded, so a case whose request nobody answers fails naming it, rather than hanging until the runner cancels its
 * file naming nothing.
 */
const ANSWER_WAIT_MS = 2_000;

/** A request between its call and its settlement: what a fault or a wait names it by, and where it was sent. */
type InFlight = { label: string; origin: string };

/** Everything the file's network holds. Each file runs in a module registry of its own, which `serveTheNetwork` asserts. */
const network = {
  /** The platform's own `fetch`, which nothing here ever calls: a case finding it back in place is a fault. */
  platformFetch: undefined as typeof fetch | undefined,
  /** The case running, by its name, from the setup file's `beforeEach` to the end of its `afterEach` wait. */
  running: undefined as string | undefined,
  /** The last case that ended, which names a request sent after it. */
  ended: undefined as string | undefined,
  sent: [] as BackendRequest[],
  served: [] as BackendRequest[],
  initial: undefined as BackendAnswer | undefined,
  answering: undefined as BackendAnswer | undefined,
  /** Answers that stand in every case ahead of the case's own, each passing a request it leaves `undefined` on. */
  standing: [] as BackendAnswer[],
  /** Answers consulted only where the case's own answer leaves a request `undefined`, or the file names none. */
  fallbacks: [] as BackendAnswer[],
  /** The hosts the file serves in every case, by origin. */
  fileHosts: new Map<string, Host>(),
  /** The hosts the running case serves, by origin, ahead of the file's. */
  caseHosts: new Map<string, Host>(),
  /** What went wrong out of the code's sight, each naming where its request was sent. */
  faults: [] as string[],
  /** Every request between its call and its settlement, each its own entry, so two alike are two. */
  inFlight: new Set<InFlight>(),
};

/** Whether a case is running, from the setup file's `beforeEach` to the end of its `afterEach` wait. */
export const caseRunning = (): boolean => network.running !== undefined;

/** Where a request sent now is sent: in a case, after one, or before the first. */
const originNow = (): string =>
  network.running !== undefined
    ? `in "${network.running}"`
    : network.ended !== undefined
      ? `after "${network.ended}" ended`
      : "before the first case";

const fault = ({ origin }: InFlight, what: string): void => {
  network.faults.push(`${what} (sent ${origin})`);
};

const thrown = (error: unknown): string => (error instanceof Error ? (error.stack ?? error.message) : String(error));

const labelOf = ({ method, path, search }: BackendRequest): string => `${method} ${path}${search.size > 0 ? `?${search.toString()}` : ""}`;

/** The body a request carried: JSON parsed, any other text as text, none as `undefined`. */
async function bodyOf(request: Request): Promise<unknown> {
  const text = await request.text();
  if (text === "") return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

const responseOf = (answer: unknown): Response =>
  answer instanceof Response ? answer : new Response(JSON.stringify(answer), { status: 200, headers: { "content-type": "application/json" } });

/** The answer to one backend request, standing answers first; a request nothing answers is a fault and a failed request. */
async function backendAnswerOf(entry: InFlight, request: BackendRequest): Promise<Response> {
  const label = labelOf(request);
  try {
    for (const stand of network.standing) {
      const answer = await stand(request);
      if (answer !== undefined) {
        network.served.push(request);
        return responseOf(answer);
      }
    }

    network.sent.push(request);
    const answer = network.answering === undefined ? undefined : await network.answering(request);
    if (answer !== undefined) return responseOf(answer);

    for (const fallback of network.fallbacks) {
      const answered = await fallback(request);
      if (answered !== undefined) return responseOf(answered);
    }
    fault(entry, `nothing answered ${label}`);
  } catch (error) {
    fault(entry, `the answer to ${label} threw: ${thrown(error)}`);
  }

  return Response.error();
}

/** The answer to one request, by its host: the backend's, a served host's, or a fault and a failed request. */
async function answerOf(entry: InFlight, request: Request): Promise<Response> {
  const url = new URL(request.url);
  const body = await bodyOf(request);
  if (url.origin === new URL(BACKEND_ORIGIN).origin && url.pathname.startsWith(`${BASE_PATH}/`)) {
    const read = {
      method: request.method,
      path: url.pathname.slice(BASE_PATH.length),
      search: url.searchParams,
      headers: request.headers,
      body,
    };
    return backendAnswerOf(entry, read);
  }

  const host = network.caseHosts.get(url.origin) ?? network.fileHosts.get(url.origin);
  if (host === undefined) {
    fault(entry, `no case serves ${request.method} ${request.url}`);
    return Response.error();
  }
  const read: HostRequest = { method: request.method, url, headers: request.headers, body };
  host.taken.push(read);
  try {
    const answer = await host.answer(read);
    if (answer !== undefined) return responseOf(answer);
    fault(entry, `nothing answered ${request.method} ${request.url}`);
  } catch (error) {
    fault(entry, `the answer to ${request.method} ${request.url} threw: ${thrown(error)}`);
  }

  return Response.error();
}

/** Settles with the signal's reason once it aborts, as the platform's `fetch` rejects an aborted request. */
const abortOf = (signal: AbortSignal): Promise<never> =>
  new Promise((_, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason as Error), { once: true });
  });

/**
 * The global `fetch` every test runs under, shaped as the platform's: it builds a real `Request` from its arguments, a
 * relative address resolved against the page's where one is open (jsdom's `http://localhost/`) and refused as Node
 * refuses one where none is; an aborted signal rejects with its reason, before or during the answer; and an answer of
 * `Response.error()` rejects as a network failure does, a `TypeError` naming `fetch failed`, which
 * `fl_frontend/src/core/api.ts` reads as an `APINetworkError`.
 */
async function answeringFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const relative = typeof input === "string" && typeof location !== "undefined" && !URL.canParse(input);
  const request = new Request(relative ? new URL(input, location.href) : input, init);
  const entry: InFlight = { label: `${request.method} ${request.url}`, origin: originNow() };
  network.inFlight.add(entry);
  try {
    if (request.signal.aborted) throw request.signal.reason as Error;
    const response = await Promise.race([answerOf(entry, request), abortOf(request.signal)]);
    if (response.type === "error") throw new TypeError("fetch failed", { cause: new Error(`the network failed ${entry.label}`) });

    return response;
  } finally {
    network.inFlight.delete(entry);
  }
}

/** Waits until no request is in flight, read again after a turn, which waits for a request an answer set off. */
async function untilAnswered(): Promise<void> {
  const lapse = new AbortController();
  const lapsed = wallClock(ANSWER_WAIT_MS, true, { signal: lapse.signal, ref: false }).catch(() => false);
  try {
    do {
      const turned = nextTurn().then(() => false);
      if (await Promise.race([turned, lapsed])) {
        const open = [...network.inFlight].map(({ label, origin }) => `${label} (sent ${origin})`);
        assert.fail(`still unanswered after ${String(ANSWER_WAIT_MS)} ms: ${open.join(", ")}`);
      }
    } while (network.inFlight.size > 0);
  } finally {
    lapse.abort();
  }
}

/** Fails, naming each, on the faults raised since the last check. */
function assertNoFaults(when: string): void {
  const faults = network.faults.splice(0);
  assert(faults.length === 0, `the network saw what no case answered, ${when}:\n${faults.join("\n")}`);
}

/** A fault where the platform's own `fetch` is back in place, which would send what the code asks; ours is put back. */
function keepOurFetch(): void {
  if (globalThis.fetch !== network.platformFetch) return;
  network.faults.push(`the platform's own fetch was put back ${originNow()}, so a request could leave the machine`);
  globalThis.fetch = answeringFetch;
}

/**
 * Installs the answering `fetch`, from `fl_frontend/src/test-support/setup.ts`, before any test file's own code: a
 * request a file sends while it loads is answered too. Assigned rather than stubbed through `vi.stubGlobal`, which
 * would record the platform's `fetch` as the original: a suite's own `vi.unstubAllGlobals()` would put that back and
 * send its next request for real. A suite stubbing or spying `fetch` for its own subject replaces this one for itself,
 * and its own restore, Vitest's or a saved reference, puts this one back.
 */
export function serveTheNetwork(): void {
  assert(network.platformFetch === undefined, "the network is served once per file, from the setup file");
  network.platformFetch = globalThis.fetch;
  globalThis.fetch = answeringFetch;

  // Registered from the setup file, so ahead of every file's own hooks: this `beforeEach` runs first, and the
  // `afterEach` and `afterAll` last, Vitest running after-hooks in the reverse of their order
  // (https://vitest.dev/config/sequence#sequence-hooks).
  beforeEach(async ({ task }) => {
    // A request sent between cases is judged before the next case begins, which it would otherwise be charged to.
    await untilAnswered();
    keepOurFetch();
    assertNoFaults(`raised ${originNow()}`);
    network.running = task.name;
    network.sent.length = 0;
    network.served.length = 0;
    network.answering = network.initial;
  });
  afterEach(async () => {
    try {
      await untilAnswered();
    } finally {
      keepOurFetch();
      network.ended = network.running;
      network.running = undefined;
      network.caseHosts.clear();
    }
    assertNoFaults(`in "${String(network.ended)}"`);
  });
  afterAll(async () => {
    await untilAnswered();
    keepOurFetch();
    assertNoFaults(`raised ${originNow()}`);
  });
}

/**
 * Answers every later request with `stand` ahead of the case's own answer, in every case of the file: the sign-in
 * store's lookups and mails, which `fl_frontend/src/test-support/authDoubles.ts` answers. A request it leaves
 * `undefined` goes on to the case's answer; one it answers is in `served`, not `sent`.
 */
export function answerInEveryCase(stand: BackendAnswer): void {
  network.standing.push(stand);
}

/**
 * Answers every later request the case's own answer leaves `undefined`, or every request where the file names no
 * answer, in every case of the file: a default a suite answering the backend itself replaces.
 */
export function answerWhereUnanswered(fallback: BackendAnswer): void {
  network.fallbacks.push(fallback);
}

/** The file's backend as a case reads and steers it. */
export type Backend = {
  /** Every request the case's answer was handed since the case began, in order. */
  readonly sent: readonly BackendRequest[];
  /** Every request a standing answer took since the case began, in order: the sign-in helpers' lookups and mails. */
  readonly served: readonly BackendRequest[];
  /** Answers every request with `next` for the rest of the case. */
  answerWith: (next: BackendAnswer) => void;
  /** Awaited before reading what a case's requests set off, so every request sent, to any host, has been answered. */
  answered: () => Promise<void>;
};

/**
 * Answers every request to `origin` (`https://challenges.cloudflare.com`, say) with `answer`, and records each: for
 * the whole file where called outside a case, for the rest of the case where called inside one, ahead of the file's.
 * `undefined` answers nothing, which fails the case.
 */
export function serveHost(origin: string, answer: HostAnswer): readonly HostRequest[] {
  assert(new URL(origin).origin === origin, `a host is served by its origin alone, not ${origin}`);
  assert(origin !== new URL(BACKEND_ORIGIN).origin, "the backend's origin is served by serveBackend");
  const hosts = caseRunning() ? network.caseHosts : network.fileHosts;
  assert(!hosts.has(origin), `${origin} is served already`);
  const host: Host = { answer, taken: [] };
  hosts.set(origin, host);

  return host.taken;
}

/**
 * The file's backend at `${API_URL}/api/v0`. Every request reaches `answer` until `answerWith` names another for the
 * rest of a case; one `serveBackend` with an answer per file, and any number without one, each reading the same record.
 */
export function serveBackend(answer?: BackendAnswer): Backend {
  if (answer !== undefined) {
    assert(network.initial === undefined, "the file's backend already answers: one serveBackend with an answer per file");
    network.initial = answer;
    network.answering = answer;
  }

  return {
    sent: network.sent,
    served: network.served,
    answerWith: (next) => void (network.answering = next),
    answered: untilAnswered,
  };
}

/**
 * The status the backend refuses `code` at, unless a case names another: a missing record at 404, which
 * `fl_frontend/src/core/errors.ts :: isRecordMissing` reads beside its code, a refused body at 422, and every rule at 409.
 */
export const refusalStatus = (code: Code | undefined): number =>
  code === "document_not_found" ? 404 : code === "payload_refused" || code === "body_unreadable" ? 422 : 409;

/**
 * The backend's failure body for `code`, or for none, as a response: the network's twin of
 * `fl_frontend/src/test-support/refusals.ts :: refused`, at `refusalStatus` unless a case names the status.
 */
export function refusal(
  code: Code | undefined,
  { status = refusalStatus(code), fields = [] }: { status?: number; fields?: readonly FLRefusedField[] } = {},
): Response {
  // Without a code where none is named, so the client reads none, as it reads a code the contract does not publish.
  const body = { ...(code === undefined ? {} : { error_code: code }), fields, trace_id: "0" };

  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** A request the network fails, as a backend or a host that never answers fails it: the code meets a `TypeError`. */
export const networkFailure = (): Response => Response.error();
