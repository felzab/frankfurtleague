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
      ["REQ-ELIGIBILITY-001", /ausgeschieden/],
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

  it("keeps the two rail-backed refusals to one sentence about the value", () => {
    // The field register `docs/frontend/spec.md` §1.12 sets. Their remedies are pinned where they
    // live, in `AdminEditSpielDataForm/banners.test.ts`: a shared module may not reach a feature.
    for (const serverErrorCode of ["REQ-ELIGIBILITY-001", "REQ-SPIELTAG-001"]) {
      const result = toActionErrorResult(new APIBadStatusError({ ...base, message: "bad", statusCode: 409, serverErrorCode }));

      assert.equal(result.error?.split(". ").length, 1, serverErrorCode);
      assert.doesNotMatch(result.error ?? "", /Hebe den Austritt auf|Ändere dort die Herkunft/, serverErrorCode);
    }
  });

  it("answers the two refusals that name no side, which no form can place", () => {
    // Own sentence and own code each: without both, a swap of the two messages, or a code that
    // stopped riding out, would still pass a check for "not the generic one".
    const own: readonly (readonly [string, RegExp])[] = [
      ["REQ-STATE-002", /Entferne zuerst die Tore/],
      ["REQ-STATE-003", /Besetze zuerst den offenen Platz/],
    ];

    for (const [serverErrorCode, sentence] of own) {
      const result = toActionErrorResult(new APIBadStatusError({ ...base, message: "bad", statusCode: 409, serverErrorCode }));

      assert.doesNotMatch(result.error ?? "", /Konflikt/, serverErrorCode);
      assert.match(result.error ?? "", sentence, serverErrorCode);
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

    assert.match(wiring.error ?? "", /Lade die Seite neu/);
    assert.doesNotMatch(occupant.error ?? "", /Lade die Seite neu/);
  });

  it("sends the seeding refusal to change the origin, never to reload", () => {
    // The two wiring codes are 409s from one function and their advice is opposite: a reload rebuilds
    // a form that never offered the shape, and only closes the answer behind this one.
    const result = toActionErrorResult(new APIBadStatusError({ ...base, message: "bad", statusCode: 409, serverErrorCode: "REQ-WIRING-002" }));

    assert.equal(result.success, false);
    assert.doesNotMatch(result.error ?? "", /Lade die Seite neu/);
    assert.match(result.error ?? "", /Herkunft/);
    assert.match(result.error ?? "", /ersten KO-Runde/);
    // The FORM register `docs/frontend/spec.md` §1.12 sets, the action second.
    assert.equal(result.error?.split(". ").length, 2);
    assert.match(result.error?.split(". ")[1] ?? "", /^Wähle/);
    // No side rides back: the failure body names none, so a form placing this on one would guess.
    assert.equal(result.errorCode, undefined);
  });

  it("sends the unrun-group refusal to reload, and names the group as the fault", () => {
    // Unlike the seeding refusal above: the picker offers only the season's groups, so this code
    // arriving means the season was redrawn narrower under the open form, and a reload renews it.
    const result = toActionErrorResult(new APIBadStatusError({ ...base, message: "bad", statusCode: 409, serverErrorCode: "REQ-WIRING-003" }));

    assert.equal(result.success, false);
    assert.match(result.error ?? "", /Gruppe/);
    assert.match(result.error ?? "", /Lade die Seite neu/);
    // No side rides back: the failure body names none, so a form placing this on one would guess.
    assert.equal(result.errorCode, undefined);
  });

  it("maps a 404 onto the vanished-record message", () => {
    const result = toActionErrorResult(new APIBadStatusError({ ...base, message: "bad", statusCode: 404 }));

    assert.match(result.error ?? "", /nicht gefunden/);
  });

  it("distinguishes a timeout from an unreachable server", () => {
    const timeout = toActionErrorResult(new APINetworkError({ ...base, message: "t", isTimeout: true }));
    const down = toActionErrorResult(new APINetworkError({ ...base, message: "d", isTimeout: false }));

    assert.match(timeout.error ?? "", /zu lange nicht geantwortet/);
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
