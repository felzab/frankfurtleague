import { describe, expect, it } from "vitest";

import { APIBadStatusError, APINetworkError, requestOf } from "./errors";

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
