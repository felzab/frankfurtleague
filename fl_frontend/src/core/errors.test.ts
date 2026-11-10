import { assert, describe, expect, it } from "vitest";

import { APIBadStatusError, isRefusalCode, isRuleRefusal } from "./errors.ts";
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
          url: "http://backend:8000/api/v0/x",
          endpoint: "/x",
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
