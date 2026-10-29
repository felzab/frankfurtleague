import { NEXT_HEADERS_DOUBLE } from "@/test-support/actionDoubles.ts";
import { beginRenderPass, itOpensAScopeThatMemoizes, serveServerReact } from "@/test-support/cacheScope.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Only the scope's own module: a render pass is what the server build's scope stands in for.
serveServerReact();

vi.doMock("next/headers", () => NEXT_HEADERS_DOUBLE);

const { runWithIncomingTrace } = await import("./traceScope.ts");
const { boundCall, getRequestTraceId, REQUEST_DEADLINE_MS } = await import("@/core/requestScope");

/** `performance.now()`'s reading, which the mocked timers leave alone and `advance` moves beside them. */
let clock = 0;
const advance = (ms: number) => {
  clock += ms;
  vi.advanceTimersByTime(ms);
};

const OWN_BOUND_MS = 15000;

beforeEach(() => {
  clock = 0;
  vi.spyOn(performance, "now").mockImplementation(() => clock);
  vi.useFakeTimers({ toFake: ["setTimeout"] });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("the scope a page render's reads enter one after another", () => {
  /* First, so a scope that failed to take fails here rather than under every case below. */
  itOpensAScopeThatMemoizes();

  /* A page has no single entry to anchor on: each slice read enters on its own, and a deadline per
     read would give every read of a slow render the whole budget again. */
  it("is one scope for the whole render, the first read's deadline and trace among it", async () => {
    beginRenderPass();
    const firstTrace = await runWithIncomingTrace(() => Promise.resolve(getRequestTraceId()));
    advance(REQUEST_DEADLINE_MS - 5000);

    const [signal, laterTrace] = await runWithIncomingTrace(() =>
      Promise.resolve([boundCall(OWN_BOUND_MS).signal, getRequestTraceId()] as const),
    );
    advance(4999);
    expect(signal.aborted, "the later read was aborted before the render's deadline").toBe(false);
    advance(1);

    expect(signal.aborted, "the later read started a deadline of its own").toBe(true);
    expect(laterTrace, "the later read opened a trace of its own inside one request").toBe(firstTrace);
  });

  it("starts afresh for the next request's render", async () => {
    beginRenderPass();
    const firstTrace = await runWithIncomingTrace(() => Promise.resolve(getRequestTraceId()));
    advance(REQUEST_DEADLINE_MS);

    beginRenderPass();
    const [signal, nextTrace] = await runWithIncomingTrace(() =>
      Promise.resolve([boundCall(OWN_BOUND_MS).signal, getRequestTraceId()] as const),
    );

    expect(signal.aborted, "a new request inherited the last one's spent deadline").toBe(false);
    expect(nextTrace, "a new request reused the last one's trace").not.toBe(firstTrace);
  });
});
