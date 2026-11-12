import { assert, describe, expect, it } from "vitest";

import { APIBadStatusError, APINetworkError, isRefusalCode, isRuleRefusal, requestOf } from "./errors.ts";
import { Code } from "./generated/client/types.ts";

describe("a refusal read by its code, whatever its status", () => {
  /* Only a rule's code or the unique index's is ever a refusal a mapper words: a credential, a request the API
     cannot take, a route, the store and the server are not. */
  it("classifies a rule's code apart from the protocol's, the store's and the server's", () => {
    for (const code of [
      "missing_actor",
      "payload_refused",
      "body_unreadable",
      "no_route",
      "document_not_found",
      "no_database_client",
      "unhandled_crash",
    ] satisfies Code[]) {
      expect(isRefusalCode(code), code).toBe(false);
    }
    for (const code of ["swap_not_a_swap", "link_invalid", "duplicate_key"] satisfies Code[]) expect(isRefusalCode(code), code).toBe(true);
    expect(isRefusalCode(undefined)).toBe(false);
  });

  /* Every code the API has, at every client status it answers with: each is a rule's refusal exactly where the
     predicate says so, whichever status its rule chose. */
  it("reads every code as a rule's refusal exactly where its class says so, at any client status", () => {
    const codes = Object.values(Code);
    assert.ok(codes.some((code) => isRefusalCode(code)) && codes.some((code) => !isRefusalCode(code)), "one class is missing");

    for (const code of codes) {
      for (const status of [400, 401, 403, 404, 409, 410, 422, 429]) {
        const refusal = new APIBadStatusError({
          traceId: "ab".repeat(16),
          message: "bad",
          statusCode: status,
          serverErrorCode: code,
        });
        expect(isRuleRefusal(refusal), `${code} at ${String(status)}`).toBe(isRefusalCode(code));
      }
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
