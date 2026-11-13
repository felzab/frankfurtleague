import { documentsWrittenByAsync } from "@/test-support/stdoutCapture.ts";
import { describe, expect, it } from "vitest";

import { APIBadStatusError, APINetworkError, MailSendError } from "./errors.ts";
import { onRequestError } from "./instrumentation.ts";
import { formatTraceparent } from "./trace.ts";

import type { Instrumentation } from "next";

/** The page request that failed, as the edge's `traceparent` names it. */
const REQUEST_TRACE = "a".repeat(32);
/** An outbound call of a cache fill, which runs under a trace of its own. */
const FETCH_TRACE = "b".repeat(32);

const ROUTE = "/saisons/[saison]";

type Context = Parameters<Instrumentation.onRequestError>[2];

const CONTEXT: Context = {
  routerKind: "App Router",
  routePath: ROUTE,
  routeType: "render",
  renderSource: "server-rendering",
  revalidateReason: undefined,
};

/** The crash line the hook writes for `thrown`, its clock reading left out. */
async function crashLine(thrown: unknown): Promise<Record<string, unknown>> {
  const request = { path: "/saisons/2026", method: "GET", headers: { traceparent: formatTraceparent(REQUEST_TRACE) } };
  const [line, ...rest] = await documentsWrittenByAsync(async () => onRequestError(thrown, request, CONTEXT));
  expect(rest).toStrictEqual([]);

  const { timestamp: _timestamp, ...fields } = line ?? {};
  return fields;
}

/** The fields every crash line carries, whatever was thrown. */
const ENVELOPE = { level: "ERROR", service: "fl_frontend", trace_id: REQUEST_TRACE, message: "system.request_crashed", route: ROUTE };

// Run by the `unit-production` project under a production build's `NODE_ENV`, whose crash line is the JSON one.
describe("the request-error hook", () => {
  /* Next catches a throw of the hook's own and prints it as plain text, so the line joining the crash to its request
     would be lost exactly where the server threw something no reader expects. */
  it("writes the crash line for a thrown value that is no error", async () => {
    expect(await crashLine(undefined)).toStrictEqual({ ...ENVELOPE, name: "unknown" });
  });

  it("names the failing call's trace and status for a backend answer gone wrong", async () => {
    const failed = new APIBadStatusError({ message: "Service unavailable.", statusCode: 503, traceId: FETCH_TRACE });

    expect(await crashLine(failed)).toStrictEqual({ ...ENVELOPE, name: "APIBadStatusError", fetch_trace_id: FETCH_TRACE, status: 503 });
  });

  it("names the failing call's trace and status for a mail the provider refused", async () => {
    const failed = new MailSendError({ message: "Rate limited.", statusCode: 429, traceId: FETCH_TRACE });

    expect(await crashLine(failed)).toStrictEqual({ ...ENVELOPE, name: "MailSendError", fetch_trace_id: FETCH_TRACE, status: 429 });
  });

  /* Next hands this hook no response status, and a call that never answered has none to give. */
  it("names the failing call's trace and no status for a call that never answered", async () => {
    const failed = new APINetworkError({ message: "Request failed.", traceId: FETCH_TRACE, originalError: new TypeError("fetch failed") });

    expect(await crashLine(failed)).toStrictEqual({ ...ENVELOPE, name: "APINetworkError", fetch_trace_id: FETCH_TRACE });
  });

  it("names no second trace for a call made under the page request's own", async () => {
    const failed = new APIBadStatusError({ message: "Service unavailable.", statusCode: 503, traceId: REQUEST_TRACE });

    expect(await crashLine(failed)).toStrictEqual({ ...ENVELOPE, name: "APIBadStatusError", status: 503 });
  });

  /* The digest is what the visitor's error page and Next's own printed error share, and Next sets it on the error. */
  it("carries the digest Next set on the error", async () => {
    const failed = Object.assign(new Error("Render failed."), { digest: "1234567890" });

    expect(await crashLine(failed)).toStrictEqual({ ...ENVELOPE, name: "Error", digest: "1234567890" });
  });
});
