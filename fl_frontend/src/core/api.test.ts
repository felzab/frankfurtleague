import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";

import { z } from "zod";

import { registerDoubles } from "./exportingModule.ts";
import { documentsWrittenByAsync } from "./stdoutCapture.ts";

// Replaced at the module boundary: the real config reads credentials no test run holds, and
// the client composes its base URL from `API_URL` at import.
const CONFIG_DOUBLE = {
  frontend_config: {
    API_URL: "http://backend:8000",
    API_VERSION: 0,
    LOG_FORMAT: "json",
    LOG_LEVEL: "INFO",
  },
  internalApiKeyBase: () => "base-key-double",
  internalApiKeySystem: () => "system-key-double",
  internalApiKeyAdmin: () => "admin-key-double",
};

registerDoubles({
  modules: {
    "core/config.ts": CONFIG_DOUBLE,
  },
});

const { apiClient } = await import("./api.ts");
const { APIBadStatusError, APIMalformedDataError, APINetworkError, ApiUnsentError, UnattributedAdminCallError } = await import("./errors.ts");
const { REQUEST_DEADLINE_MS, requestOutcomeUnknown, requestWriteSent, runWithRequestScope } = await import("./requestScope.ts");
const { ACTOR_HEADER, readTraceparent, TRACEPARENT_HEADER } = await import("./trace.ts");

const TRACE = "a".repeat(32);
const SPAN = "b".repeat(16);

/** What the doubled transport was asked to send, and whether the request had recorded a write by then. */
const sends: { url: string; init: RequestInit; wroteBeforeSend: boolean }[] = [];

/** The backend's answer to the next call, read once; unset, an empty list. */
let nextAnswer: Response | undefined;

/** Whether the next call is cut off as the client's own timeout cuts it, read once. */
let nextTimesOut = false;

/** Whether the next call's headers arrive and its body then never does until the call aborts, read once. */
let nextStalls = false;

/** How long the next call takes to answer, on the mocked timers, read once. */
let nextAnswersAfterMs: number | undefined;

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  sends.push({ url: String(input), init: init ?? {}, wroteBeforeSend: requestWriteSent() });
  if (nextAnswersAfterMs !== undefined) {
    const delay = nextAnswersAfterMs;
    nextAnswersAfterMs = undefined;
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
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

  const ADMIN_ACTOR = { email: "admin@frankfurtleague.de", lane: "admin", token: "admin-lane-token-double" } as const;
  const PERSON_ACTOR = { email: "spielerin@example.org", lane: "person", token: "person-lane-token-double" } as const;

  /** The actor header the one call sent from a scope recording `actor`, under `authType`. */
  async function actorSent(
    actor: typeof ADMIN_ACTOR | typeof PERSON_ACTOR,
    authType?: "base" | "system" | "admin" | "none",
  ): Promise<string | null> {
    await runWithRequestScope({ traceId: TRACE, spanId: SPAN, actor: actor }, () =>
      apiClient("/saisons", z.array(z.unknown()), { authType: authType, headers: { ...CALLER_HEADERS } }),
    );

    return new Headers(sends.at(-1)?.init.headers).get(ACTOR_HEADER);
  }

  // The signed token alone: the backend believes no address it cannot verify. A person's route rides
  // the admin key too, so whichever guard recorded the actor, the token goes.
  it("sends the scope's token on an admin-tier call, whichever lane recorded it, and never the address", async () => {
    assert.equal(await actorSent(ADMIN_ACTOR, "admin"), ADMIN_ACTOR.token);
    assert.equal(await actorSent(PERSON_ACTOR, "admin"), PERSON_ACTOR.token);
  });

  // The error is what a spine hands the logger, and the token a bearer credential while it lives: a
  // refused call and one that never landed each come back carrying none of it.
  it("puts the token into no error an admin-tier call throws", async () => {
    const failures: unknown[] = [];
    nextAnswer = new Response(JSON.stringify({ error_code: "REQ-AUTH-006" }), { status: 403, headers: { "content-type": "application/json" } });
    failures.push(
      await actorSent(ADMIN_ACTOR, "admin").then(
        () => undefined,
        (error: unknown) => error,
      ),
    );
    nextTimesOut = true;
    failures.push(
      await actorSent(ADMIN_ACTOR, "admin").then(
        () => undefined,
        (error: unknown) => error,
      ),
    );

    for (const failure of failures) {
      assert.ok(failure instanceof Error, "the call did not fail, so nothing below was asked");
      const seen = JSON.stringify({ ...failure, message: failure.message, stack: failure.stack }, (_key, value: unknown) =>
        value instanceof Error ? { ...value, message: value.message, stack: value.stack } : value,
      );
      assert.ok(!seen.includes(ADMIN_ACTOR.token), `${failure.name} carried the token`);
    }
  });

  // A base or system call is the app acting as itself: an actor on one would attribute a machine read
  // to a person, and a caller's own header is taken off rather than passed on.
  for (const authType of [undefined, "base", "system", "none"] as const) {
    it(`sends no actor at all on a ${authType ?? "default"}-tier call, though the scope holds one`, async () => {
      assert.equal(await actorSent(ADMIN_ACTOR, authType), null);
    });
  }

  // The backend refuses it on arrival (REQ-AUTH-005), and the sweep over every query relies on this
  // refusal to name a read that opened outside `runAdminRead`. A caller's own header names nobody.
  it("refuses an admin call whose scope names nobody before anything is sent", async () => {
    await assert.rejects(
      runWithRequestScope({ traceId: TRACE, spanId: SPAN }, () =>
        apiClient("/saisons", z.array(z.unknown()), { authType: "admin", headers: { ...CALLER_HEADERS } }),
      ),
      UnattributedAdminCallError,
    );
    await assert.rejects(apiClient("/saisons", z.array(z.unknown()), { authType: "admin" }), UnattributedAdminCallError);

    assert.deepEqual(sends, []);
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

describe("the write a call records in its request", () => {
  /** Whether the request recorded a write once `options` was sent and failed or answered. */
  const recorded = (options: RequestInit & { readOnly?: true }, arrange: () => void = () => undefined) =>
    runWithRequestScope({ traceId: TRACE, spanId: SPAN }, async () => {
      arrange();
      await apiClient("/x", z.unknown(), options).catch(() => undefined);

      return requestWriteSent();
    });

  /* Recorded as it leaves: a write whose answer never came may still have landed. */
  it("records a write as it is sent, answered or not", async () => {
    assert.equal(await recorded({ method: "POST" }), true, "an answered write went unrecorded");
    assert.equal(await recorded({ method: "PATCH" }, () => void (nextTimesOut = true)), true, "an unanswered write went unrecorded");
  });

  /* The transport is where the answer may be lost, so the write is on the record before it is handed over. */
  it("records a write before the transport is handed it", async () => {
    await recorded({ method: "PATCH" });

    assert.equal(sends.at(-1)?.wroteBeforeSend, true, "the write was recorded only once the transport had it");
  });

  it("records none for a GET, or for a POST declaring itself read-only", async () => {
    assert.deepEqual([await recorded({}), await recorded({ method: "POST", readOnly: true })], [false, false]);
  });

  /* `fetch` sends a method exactly as typed, so a safe method spelled in lower case changes nothing either. */
  it("reads a method's spelling as the backend does", async () => {
    assert.deepEqual([await recorded({ method: "get" }), await recorded({ method: "patch" })], [false, true]);
  });
});

describe("the client's own timeout", () => {
  const TIMEOUT_MS = 1000;

  /* `fetch` resolves on the headers, so a timer cleared there leaves a stalled body hanging the render.
     Asserted at the tick: on a mocked clock nothing else ends that body, so the regression fails
     rather than hangs. */
  it("aborts a body that stalls once the headers have arrived, as a timed-out request", async () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    try {
      nextStalls = true;
      const pending = apiClient("/x", z.unknown(), { timeoutMs: TIMEOUT_MS }).then(
        () => assert.fail("the stalled body resolved"),
        (error: unknown) => error,
      );
      await new Promise((resolve) => setImmediate(resolve));
      mock.timers.tick(TIMEOUT_MS);
      const signal = sends.at(-1)?.init.signal ?? assert.fail("the call sent no signal");
      assert.equal(signal.aborted, true, "the timeout elapsed and nothing aborted the stalled body");

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

describe("the request's deadline over a chain of calls", () => {
  /** Each link answers inside the client's own bound, and two of them leave less than one bound of the deadline. */
  const LINK_MS = 14000;

  /** `performance.now()`'s reading, which the mocked timers leave alone and `advance` moves beside them. */
  let clock = 0;
  const advance = (ms: number) => {
    clock += ms;
    mock.timers.tick(ms);
  };
  const reachFetch = () => new Promise((resolve) => setImmediate(resolve));

  beforeEach(() => {
    clock = 0;
    mock.method(performance, "now", () => clock);
    mock.timers.enable({ apis: ["setTimeout"] });
  });

  afterEach(() => {
    mock.timers.reset();
    mock.restoreAll();
  });

  /* Asserted at the tick, one millisecond either side: on the mocked clock nothing else ends the stalled
     third body, so a client ignoring the deadline fails here instead of hanging. */
  it("aborts the call that would outlast it at what the chain left, not at the call's own bound", async () => {
    const [thrown, cut] = await runWithRequestScope({ traceId: TRACE, spanId: SPAN }, async () => {
      for (const link of ["/erste", "/zweite"]) {
        nextAnswersAfterMs = LINK_MS;
        const answered = apiClient(link, z.unknown());
        await reachFetch();
        advance(LINK_MS);
        await answered;
      }

      nextStalls = true;
      const third = apiClient("/dritte", z.unknown(), { method: "POST" }).then(
        () => assert.fail("the stalled body resolved"),
        (error: unknown) => error,
      );
      await reachFetch();
      const signal = sends.at(-1)?.init.signal ?? assert.fail("the third call sent no signal");

      advance(REQUEST_DEADLINE_MS - 2 * LINK_MS - 1);
      assert.equal(signal.aborted, false, "the third call was aborted before the deadline");
      advance(1);
      assert.equal(signal.aborted, true, "the deadline passed and the third call ran on to its own bound");

      return [await third, requestOutcomeUnknown()];
    });

    assert.ok(thrown instanceof APINetworkError, "the cut call was not thrown as a network error");
    assert.equal(thrown.isTimeout, true, "the cut call was not answered as a timeout");
    assert.equal(cut, true, "the request does not know its deadline cut a call");
  });

  /** What a call made once nothing is left throws, and whether the request recorded a write for it. */
  const refusedUnsent = (options: RequestInit) =>
    runWithRequestScope({ traceId: TRACE, spanId: SPAN }, async () => {
      advance(REQUEST_DEADLINE_MS);

      const error = await apiClient("/x", z.unknown(), options).then(
        () => assert.fail("the call past the deadline resolved"),
        (failure: unknown) => failure,
      );

      return [error, requestWriteSent()] as const;
    });

  /* Not a network error, which every reader of one takes for a write that may have landed: nothing left. */
  it("draws no request once nothing is left, and throws a write as unsent", async () => {
    const [thrown, wrote] = await refusedUnsent({ method: "POST" });

    assert.equal(sends.length, 0, "a request was drawn after the deadline had passed");
    assert.equal(wrote, false, "a write the deadline refused unsent was recorded as sent");
    assert.ok(thrown instanceof ApiUnsentError, "the refused write was thrown as one that may have landed");
  });

  it("throws a read refused unsent as the timeout it answers like", async () => {
    const [thrown] = await refusedUnsent({});

    assert.equal(sends.length, 0, "a request was drawn after the deadline had passed");
    assert.ok(thrown instanceof APINetworkError, "the refused read was not thrown as a network error");
    assert.deepEqual([thrown.isTimeout, thrown.method], [true, "GET"]);
  });
});
