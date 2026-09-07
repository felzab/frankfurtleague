import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { afterEach, describe, it } from "node:test";

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
const { runWithRequestScope } = await import("./requestScope.ts");
const { ACTOR_HEADER, readTraceparent, TRACEPARENT_HEADER } = await import("./trace.ts");

const TRACE = "a".repeat(32);
const SPAN = "b".repeat(16);

/** What the doubled transport was asked to send. */
const sends: { url: string; init: RequestInit }[] = [];

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  sends.push({ url: String(input), init: init ?? {} });
  return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
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
