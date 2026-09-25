import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { afterEach, beforeEach, describe, it, mock } from "node:test";

import { beginRenderPass, itOpensAScopeThatMemoizes, SERVER_REACT_URL } from "@/shared/testing/cacheScope.ts";

const HEADERS_DOUBLE_URL = `data:text/javascript,${encodeURIComponent("export const headers = async () => new Headers();")}`;

registerHooks({
  resolve(specifier, context, nextResolve) {
    // Only for the scope's own module: this process's `react` is the client build, whose `cache`
    // memoizes nothing, and a render pass is what the server build's scope stands in for.
    if (specifier === "react" && context.parentURL?.endsWith("/src/core/requestScope.ts")) return { url: SERVER_REACT_URL, shortCircuit: true };
    if (specifier === "next/headers") return { url: HEADERS_DOUBLE_URL, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

const { runWithIncomingTrace } = await import("./traceScope.ts");
const { boundCall, getRequestSpanId, REQUEST_DEADLINE_MS } = await import("@/core/requestScope");

/** `performance.now()`'s reading, which the mocked timers leave alone and `advance` moves beside them. */
let clock = 0;
const advance = (ms: number) => {
  clock += ms;
  mock.timers.tick(ms);
};

const OWN_BOUND_MS = 15000;

beforeEach(() => {
  clock = 0;
  mock.method(performance, "now", () => clock);
  mock.timers.enable({ apis: ["setTimeout"] });
});

afterEach(() => {
  mock.timers.reset();
  mock.restoreAll();
});

describe("the scope a page render's reads enter one after another", () => {
  /* First, so a scope that failed to take fails here rather than under every case below. */
  itOpensAScopeThatMemoizes();

  /* A page has no single entry to anchor on: each slice read enters on its own, and a deadline per
     read would give every read of a slow render the whole budget again. */
  it("is one scope for the whole render, the first read's deadline and span among it", async () => {
    beginRenderPass();
    const firstSpan = await runWithIncomingTrace(() => Promise.resolve(getRequestSpanId()));
    advance(REQUEST_DEADLINE_MS - 5000);

    const [signal, laterSpan] = await runWithIncomingTrace(() =>
      Promise.resolve([boundCall(OWN_BOUND_MS).signal, getRequestSpanId()] as const),
    );
    advance(4999);
    assert.equal(signal.aborted, false, "the later read was aborted before the render's deadline");
    advance(1);

    assert.equal(signal.aborted, true, "the later read started a deadline of its own");
    assert.equal(laterSpan, firstSpan, "the later read opened a span of its own inside one request");
  });

  it("starts afresh for the next request's render", async () => {
    beginRenderPass();
    const firstSpan = await runWithIncomingTrace(() => Promise.resolve(getRequestSpanId()));
    advance(REQUEST_DEADLINE_MS);

    beginRenderPass();
    const [signal, nextSpan] = await runWithIncomingTrace(() => Promise.resolve([boundCall(OWN_BOUND_MS).signal, getRequestSpanId()] as const));

    assert.equal(signal.aborted, false, "a new request inherited the last one's spent deadline");
    assert.notEqual(nextSpan, firstSpan, "a new request reused the last one's span");
  });
});
