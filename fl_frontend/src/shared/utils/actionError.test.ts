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

  it("gives each occupant refusal its own advice, and hands the code back", () => {
    // The code is the only channel a failure body has (`docs/logging/spec.md`, L4), so it has to
    // survive the mapping: the form turns it into a message on a specific side. A dropped
    // code falls back to a toast naming no field.
    const refusals: [string, RegExp][] = [
      ["REQ-ELIGIBILITY-001", /disqualifiziert/],
      ["REQ-ELIGIBILITY-002", /nimmt nicht an dieser Saison teil/],
      ["REQ-SPIELTAG-001", /selben Spieltag/],
    ];

    for (const [serverErrorCode, expected] of refusals) {
      const result = toActionErrorResult(new APIBadStatusError({ ...base, message: "bad", statusCode: 409, serverErrorCode }));

      assert.equal(result.success, false, serverErrorCode);
      assert.match(result.error ?? "", expected, serverErrorCode);
      assert.equal(result.errorCode, serverErrorCode);
    }
  });

  it("does not send an occupant refusal to reload the page, as a wiring refusal does", () => {
    // The two are both 409s on the same endpoint and the advice is opposite: the season has moved
    // under a wiring refusal, and has not moved at all under an occupant one.
    const wiring = toActionErrorResult(new APIBadStatusError({ ...base, message: "bad", statusCode: 409, serverErrorCode: "REQ-WIRING-001" }));
    const occupant = toActionErrorResult(
      new APIBadStatusError({ ...base, message: "bad", statusCode: 409, serverErrorCode: "REQ-ELIGIBILITY-001" }),
    );

    assert.match(wiring.error ?? "", /neu/);
    assert.doesNotMatch(occupant.error ?? "", /lade die Seite neu/);
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
