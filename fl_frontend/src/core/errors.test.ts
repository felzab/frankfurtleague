import { describe, expect, it } from "vitest";

import { APIBadStatusError, APINetworkError, orMissing, requestOf } from "./errors";

import type { Code } from "./generated/client/types";

/* By the code and never the status: a 404 carrying none is a route the edge or the framework did not find, and read as
   a missing record it would draw a page's missing state while the API is unreachable. */
describe("a read of a record the API says is missing", () => {
  it("answers none for the record-missing code alone, and rethrows a 404 carrying no code or the router's", async () => {
    const notFound = (code: Code | undefined) =>
      new APIBadStatusError({ traceId: "ab".repeat(16), message: "", statusCode: 404, serverErrorCode: code });

    await expect(orMissing(Promise.reject(notFound("document_not_found")))).resolves.toBeNull();
    for (const code of [undefined, "no_route"] as const) {
      const failure = notFound(code);
      await expect(orMissing(Promise.reject(failure)), `a 404 with ${String(code)}`).rejects.toBe(failure);
    }
  });
});

/* A refusal and a crash carry the same error name on a failure line: the status and code tell them apart, and the
   trace joins the line to the backend's own for that request. A call the backend never answered has the trace alone. */
describe("the request a failure line names", () => {
  it("says a refused call's status, code and trace, an unanswered call's trace, and nothing of any other throw", () => {
    const traceId = "4bf92f3577b34da6a3ce929d0e0e4736";
    const refusal = new APIBadStatusError({ traceId, message: "", statusCode: 409, serverErrorCode: "no_owner" });
    const unanswered = new APINetworkError({ traceId, message: "" });

    expect(requestOf(refusal)).toStrictEqual({ status: 409, server_error_code: "no_owner", trace_id: traceId });
    expect(requestOf(unanswered)).toStrictEqual({ trace_id: traceId });
    expect(requestOf(new TypeError("fetch failed"))).toStrictEqual({});
  });
});
