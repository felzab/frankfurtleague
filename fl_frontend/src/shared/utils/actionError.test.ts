/**
 * SHARED · action error mapping tests
 *
 * A thrown API error must come back as a `FormState` the form can toast — never escape to the error
 * page — and the 409 case must be distinguishable, because a unique-index refusal is an ordinary
 * outcome of a create (ADR-0032, docs/logging.md).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { APIBadStatusError, APIMalformedDataError, APINetworkError } from "@/core/errors.ts";

import { toActionErrorResult } from "./actionError.ts";

const base = { url: "http://backend:8000/api/v0/x", endpoint: "/x", correlationId: "ab".repeat(16) };

describe("toActionErrorResult", () => {
  it("maps a 409 onto the conflict message, not the generic one", () => {
    const result = toActionErrorResult(new APIBadStatusError({ ...base, message: "bad", statusCode: 409, serverErrorCode: "DB-COMMON-002" }));

    assert.equal(result.success, false);
    assert.match(result.error ?? "", /Konflikt/);
  });

  it("maps a 404 onto the vanished-record message", () => {
    const result = toActionErrorResult(new APIBadStatusError({ ...base, message: "bad", statusCode: 404 }));

    assert.match(result.error ?? "", /nicht gefunden/);
  });

  it("distinguishes a timeout from an unreachable server", () => {
    const timeout = toActionErrorResult(new APINetworkError({ ...base, message: "t", isTimeout: true }));
    const down = toActionErrorResult(new APINetworkError({ ...base, message: "d", isTimeout: false }));

    assert.match(timeout.error ?? "", /Zeitüberschreitung/);
    assert.match(down.error ?? "", /nicht erreichbar/);
    assert.notEqual(timeout.error, down.error);
  });

  it("maps malformed data onto its own message", () => {
    const result = toActionErrorResult(new APIMalformedDataError({ ...base, message: "m", statusCode: 200 }));

    assert.match(result.error ?? "", /fehlerhaft/);
  });

  it("never lets an unknown throw escape without a result", () => {
    const result = toActionErrorResult(new Error("anything"));

    assert.equal(result.success, false);
    assert.equal(typeof result.error, "string");
  });
});
