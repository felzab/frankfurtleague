import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { afterEach, describe, it, mock } from "node:test";

import { z } from "zod";

import { documentsWrittenByAsync } from "./stdoutCapture.ts";

/** Stands in for `server-only`, whose real module throws outside a React server build. */
const SERVER_ONLY_DOUBLE_URL = `data:text/javascript,${encodeURIComponent("export {};")}`;

// Replaced at the module boundary: the real config reads three credentials no test run holds, and
// the client composes its base URL from `API_URL` at import.
const CONFIG_DOUBLE = `export const frontend_config = {
  API_URL: "http://backend:8000",
  API_VERSION: 0,
  INTERNAL_API_KEY_BASE: "base-key-double",
  INTERNAL_API_KEY_SYSTEM: "system-key-double",
  INTERNAL_API_KEY_ADMIN: "admin-key-double",
  LOG_FORMAT: "json",
  LOG_LEVEL: "INFO",
};`;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") return { url: SERVER_ONLY_DOUBLE_URL, shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.endsWith("/src/core/config.ts")) return { format: "module", source: CONFIG_DOUBLE, shortCircuit: true };
    return nextLoad(url, context);
  },
});

const { apiClient } = await import("./api.ts");
const { APIBadStatusError, APIMalformedDataError, APINetworkError } = await import("./errors.ts");
const { runWithRequestScope } = await import("./requestScope.ts");
const { ACTOR_HEADER, readTraceparent, TRACEPARENT_HEADER } = await import("./trace.ts");

const TRACE = "a".repeat(32);
const SPAN = "b".repeat(16);

/** What the doubled transport was asked to send. */
const sends: { url: string; init: RequestInit }[] = [];

/** The backend's answer to the next call, read once; unset, an empty list. */
let nextAnswer: Response | undefined;

/** Whether the next call is cut off as the client's own timeout cuts it, read once. */
let nextTimesOut = false;

/** Whether the next call's headers arrive and its body then never does until the call aborts, read once. */
let nextStalls = false;

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  sends.push({ url: String(input), init: init ?? {} });
  if (nextTimesOut) {
    nextTimesOut = false;
    throw new DOMException("The operation was aborted.", "AbortError");
  }
  if (nextStalls) {
    nextStalls = false;
    const signal = init?.signal;
    const body = new ReadableStream({
      start(controller) {
        signal?.addEventListener("abort", () => controller.error(Object.assign(new Error("aborted"), { name: "AbortError" })));
      },
    });
    return new Response(body, { status: 200, headers: { "content-type": "application/json" } });
  }
  const answer = nextAnswer ?? new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
  nextAnswer = undefined;
  return answer;
}) as typeof fetch;

function sentTraceparent(): { traceId: string; spanId: string } {
  const ids = readTraceparent(new Headers(sends.at(-1)?.init.headers).get(TRACEPARENT_HEADER));
  assert.ok(ids, "the call carried no well-formed traceparent");
  return ids;
}

afterEach(() => {
  sends.length = 0;
});

describe("the cache-fill line", () => {
  /* The key list is the contract, pinned the way `logFormat.test.ts` pins a plain line: the fill's
     trace joins nothing but this line, so a reader has to know its shape without a sample. */
  it("is one INFO document under the fill's own trace, its keys in the envelope's order", async () => {
    const written = await documentsWrittenByAsync(() =>
      apiClient("/saisons", z.array(z.unknown()), { cacheFill: { name: "getSaisons", args: { saison_id: "2026" } } }),
    );

    assert.equal(written.length, 1);
    const [document] = written;
    assert.deepEqual(Object.keys(document ?? {}), ["timestamp", "level", "service", "trace_id", "span_id", "message", "cache_fill"]);
    assert.equal(document?.level, "INFO");
    assert.equal(document?.message, "cache fill");
    assert.deepEqual(document?.cache_fill, { name: "getSaisons", args: '{"saison_id":"2026"}' });
  });

  it("carries the very ids the backend receives on the header", async () => {
    const [document] = await documentsWrittenByAsync(() =>
      apiClient("/saisons", z.array(z.unknown()), { cacheFill: { name: "getSaisons", args: {} } }),
    );

    const sent = sentTraceparent();
    assert.equal(document?.trace_id, sent.traceId);
    assert.equal(document?.span_id, sent.spanId);
    assert.match(String(document?.trace_id), /^[a-f0-9]{32}$/);
  });

  // Seeded means a page request's trace, which the call already joins; the line exists for the
  // fill that has none.
  it("is not written inside a request scope, whose ids the header carries instead", async () => {
    const written = await documentsWrittenByAsync(() =>
      runWithRequestScope({ traceId: TRACE, spanId: SPAN }, () =>
        apiClient("/saisons", z.array(z.unknown()), { cacheFill: { name: "getSaisons", args: {} } }),
      ),
    );

    assert.deepEqual(written, []);
    assert.deepEqual(sentTraceparent(), { traceId: TRACE, spanId: SPAN });
  });

  it("is not written for a call that declares no fill", async () => {
    const written = await documentsWrittenByAsync(() => apiClient("/saisons", z.array(z.unknown())));

    assert.deepEqual(written, []);
  });
});

describe("the two headers this hop sets", () => {
  const CALLER_HEADERS = { [TRACEPARENT_HEADER]: `00-${"c".repeat(32)}-${"d".repeat(16)}-01`, [ACTOR_HEADER]: "someone@else.example" };

  it("carries the scope's trace rather than one the caller passed in the options", async () => {
    await runWithRequestScope({ traceId: TRACE, spanId: SPAN }, () =>
      apiClient("/saisons", z.array(z.unknown()), { headers: { ...CALLER_HEADERS } }),
    );

    assert.deepEqual(sentTraceparent(), { traceId: TRACE, spanId: SPAN });
  });

  // The actor is the admin scope's or nothing: a caller's own would attribute this read to a person
  // who never made it, and a base call mints none to overwrite one with.
  it("sends the scope's actor on an admin call and none at all on a base one", async () => {
    await runWithRequestScope({ traceId: TRACE, spanId: SPAN, actor: "admin@frankfurtleague.de" }, () =>
      apiClient("/saisons", z.array(z.unknown()), { authType: "admin", headers: { ...CALLER_HEADERS } }),
    );
    assert.equal(new Headers(sends.at(-1)?.init.headers).get(ACTOR_HEADER), "admin@frankfurtleague.de");

    await runWithRequestScope({ traceId: TRACE, spanId: SPAN, actor: "admin@frankfurtleague.de" }, () =>
      apiClient("/saisons", z.array(z.unknown()), { headers: { ...CALLER_HEADERS } }),
    );
    assert.equal(new Headers(sends.at(-1)?.init.headers).get(ACTOR_HEADER), null);
  });

  it("keeps a header the caller passes that this hop does not mint", async () => {
    await apiClient("/saisons", z.array(z.unknown()), { headers: { "X-Test-Passthrough": "kept" } });

    assert.equal(new Headers(sends.at(-1)?.init.headers).get("X-Test-Passthrough"), "kept");
  });
});

describe("a refused payload's fields", () => {
  const refusedWith = (body: unknown) => new Response(JSON.stringify(body), { status: 422, headers: { "content-type": "application/json" } });

  async function thrownBy(body: unknown): Promise<InstanceType<typeof APIBadStatusError>> {
    nextAnswer = refusedWith(body);
    const thrown: unknown = await apiClient("/schiedsrichter", z.unknown(), { method: "POST" }).then(
      () => undefined,
      (error: unknown) => error,
    );
    assert.ok(thrown instanceof APIBadStatusError, "the 422 was not thrown as a bad status");
    return thrown;
  }

  it("reach the error as the backend named them, the code beside them", async () => {
    const fields = [
      { in: "body", path: ["kontakt", "email"], kind: "value_error" },
      { in: "body", path: ["namen", 1], kind: "string_too_long" },
    ];

    const thrown = await thrownBy({ error_code: "REQ-VAL-001", trace_id: TRACE, fields });

    assert.equal(thrown.serverErrorCode, "REQ-VAL-001");
    assert.deepEqual(thrown.refusedFields, fields);
  });

  // All or nothing: one entry out of shape drops the list, so no field is marked on a path this
  // client guessed at, and the form falls back to the refusal naming none.
  it("are none where any entry is out of shape", async () => {
    const thrown = await thrownBy({
      error_code: "REQ-VAL-001",
      trace_id: TRACE,
      fields: [
        { in: "body", path: ["kontakt", "email"], kind: "value_error" },
        { in: "body", path: "kontakt.email" },
      ],
    });

    assert.equal(thrown.serverErrorCode, "REQ-VAL-001");
    assert.deepEqual(thrown.refusedFields, []);
  });

  it("are none where the body carries no list", async () => {
    const thrown = await thrownBy({ error_code: "REQ-VAL-001", trace_id: TRACE });

    assert.deepEqual(thrown.refusedFields, []);
  });
});

describe("a call the caller declares read-only", () => {
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  /** Each way a sent call fails, set up for the next call. */
  const FAILURES: Record<string, () => void> = {
    "a timeout": () => void (nextTimesOut = true),
    "a server error": () => void (nextAnswer = json(500, { error_code: "SRV-FAIL-001", trace_id: TRACE })),
    "a body failing its schema": () => void (nextAnswer = json(200, { nicht: "die Liste" })),
  };

  /** The mark the call's error carries, and the request the call sent. */
  async function failureOf(arrange: () => void, options: RequestInit & { readOnly?: true }) {
    arrange();
    const thrown: unknown = await apiClient("/x/ansicht", z.array(z.string()), options).then(
      () => undefined,
      (error: unknown) => error,
    );
    assert.ok(
      thrown instanceof APINetworkError || thrown instanceof APIBadStatusError || thrown instanceof APIMalformedDataError,
      "the failed call threw no API error",
    );

    return { readOnly: thrown.readOnly, sent: sends.at(-1)?.init ?? assert.fail("the call sent nothing") };
  }

  for (const [failure, arrange] of Object.entries(FAILURES)) {
    it(`carries its mark onto ${failure}, and a POST declaring none carries none`, async () => {
      const read = await failureOf(arrange, { method: "POST", readOnly: true });
      const write = await failureOf(arrange, { method: "POST" });

      assert.deepEqual([read.readOnly, write.readOnly], [true, false]);
      // The mark is this client's, and the backend never reads it: the read goes out as the POST it is.
      assert.equal(read.sent.method, "POST");
      assert.ok(!("readOnly" in read.sent), "the mark reached the request");
    });
  }
});

describe("the client's own timeout", () => {
  const TIMEOUT_MS = 1000;

  /* `fetch` resolves on the headers, so a timer cleared there leaves the body's read unbounded and a
     stalled backend hangs the render. Bounded here, so that regression fails rather than hangs. */
  it("aborts a body that stalls once the headers have arrived, as a timed-out request", { timeout: 5000 }, async () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    try {
      nextStalls = true;
      const pending = apiClient("/x", z.unknown(), { timeoutMs: TIMEOUT_MS }).then(
        () => assert.fail("the stalled body resolved"),
        (error: unknown) => error,
      );
      await new Promise((resolve) => setImmediate(resolve));
      mock.timers.tick(TIMEOUT_MS);

      const thrown = await pending;
      assert.ok(thrown instanceof APINetworkError, "the stalled body was not thrown as a network error");
      assert.equal(thrown.isTimeout, true);
    } finally {
      mock.timers.reset();
    }
  });

  it("stops its timer once the answer is read, so nothing aborts a call already done", async () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    try {
      await apiClient("/x", z.unknown(), { timeoutMs: TIMEOUT_MS });
      const signal = sends.at(-1)?.init.signal ?? assert.fail("the call sent no signal");
      mock.timers.tick(TIMEOUT_MS);

      assert.equal(signal.aborted, false, "the finished call's timer still fired");
    } finally {
      mock.timers.reset();
    }
  });
});
