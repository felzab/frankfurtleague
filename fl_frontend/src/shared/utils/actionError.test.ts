import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { APIBadStatusError, APIMalformedDataError, APINetworkError, RolledBackError } from "@/core/errors.ts";

import { toActionErrorResult } from "./actionError.ts";

const base = { url: "http://backend:8000/api/v0/x", endpoint: "/x", traceId: "ab".repeat(16) };

/** An editor's save, the request every refusal here answers unless a case names another. */
const write = { ...base, method: "PATCH", readOnly: false };

/** The two requests that change nothing: a safe method, and a POST its caller declared read-only. */
const READS = [
  { method: "GET", readOnly: false },
  { method: "POST", readOnly: true },
] as const;

describe("toActionErrorResult", () => {
  it("maps a 409 onto the conflict message, not the generic one", () => {
    const result = toActionErrorResult(new APIBadStatusError({ ...write, message: "bad", statusCode: 409, serverErrorCode: "DB-COMMON-002" }));

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
      const result = toActionErrorResult(new APIBadStatusError({ ...write, message: "bad", statusCode: 409, serverErrorCode }));

      assert.equal(result.success, false, serverErrorCode);
      assert.match(result.error ?? "", expected, serverErrorCode);
      assert.equal(result.errorCode, serverErrorCode);
    }
  });

  it("says a commit of unknown outcome is unclear rather than failed", () => {
    // A failure message sends the admin to repeat a write that may already stand.
    const result = toActionErrorResult(new APIBadStatusError({ ...write, message: "bad", statusCode: 500, serverErrorCode: "DB-FAIL-002" }));

    assert.equal(result.error, "Ob die Änderung gespeichert wurde, ist unklar. Lade die Seite neu und prüfe, ob sie da ist.");
    // The marker `appToast.failure` titles the toast by: the site's own title says the change did not happen.
    assert.equal(result.outcome, "unknown");
  });

  it("keeps the one code saying the write failed a failure", () => {
    // Titled unclear, it sends the admin to look for a change `DB-FAIL-001` says is not there.
    const result = toActionErrorResult(new APIBadStatusError({ ...write, message: "bad", statusCode: 500, serverErrorCode: "DB-FAIL-001" }));

    assert.equal(result.outcome, undefined);
  });

  // Each can follow a commit: a response the API could not validate, an unhandled crash, and a proxy
  // answering for a backend that stopped mid-request.
  it("says a write any other server error answered is of unknown outcome", () => {
    const answers: readonly (readonly [number, string | undefined])[] = [
      [500, "SRV-VAL-001"],
      [500, "SRV-FAIL-001"],
      [502, undefined],
      [504, undefined],
    ];

    for (const [statusCode, serverErrorCode] of answers) {
      const result = toActionErrorResult(new APIBadStatusError({ ...write, message: "bad", statusCode, serverErrorCode }));

      assert.equal(
        result.error,
        "Ob die Änderung gespeichert wurde, ist unklar. Lade die Seite neu und prüfe, ob sie da ist.",
        String(statusCode),
      );
      assert.equal(result.outcome, "unknown", String(statusCode));
    }
  });

  it("keeps a read's server error the retry it is", () => {
    for (const sent of READS) {
      const result = toActionErrorResult(
        new APIBadStatusError({ ...base, ...sent, message: "bad", statusCode: 500, serverErrorCode: "SRV-FAIL-001" }),
      );

      assert.equal(result.error, "Der Server hat mit einem Fehler geantwortet. Versuche es erneut.", sent.method);
      assert.equal(result.outcome, undefined, sent.method);
    }
  });

  it("reads the occupant table with `hasOwn`, so a code named for a prototype key is not a refusal", () => {
    // `serverErrorCode` is `String(body.error_code)` off the response with nothing narrowing it
    // (`fl_frontend/src/core/api.ts`), so `in` would select `Object.prototype.toString` — a function,
    // where every caller is promised German.
    for (const serverErrorCode of ["toString", "constructor", "valueOf"]) {
      const result = toActionErrorResult(new APIBadStatusError({ ...write, message: "bad", statusCode: 409, serverErrorCode }));

      assert.equal(typeof result.error, "string", serverErrorCode);
      assert.match(result.error ?? "", /Konflikt/, serverErrorCode);
      assert.equal(result.errorCode, undefined, serverErrorCode);
    }
  });

  it("keeps the two rail-backed refusals to one sentence about the value", () => {
    // The field register `docs/frontend/spec.md` §1.12 sets. Their remedies are pinned where they
    // live, in `AdminEditSpielDataForm/banners.test.ts`: a shared module may not reach a feature.
    for (const serverErrorCode of ["REQ-ELIGIBILITY-001", "REQ-SPIELTAG-001"]) {
      const result = toActionErrorResult(new APIBadStatusError({ ...write, message: "bad", statusCode: 409, serverErrorCode }));

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
      const result = toActionErrorResult(new APIBadStatusError({ ...write, message: "bad", statusCode: 409, serverErrorCode }));

      assert.doesNotMatch(result.error ?? "", /Konflikt/, serverErrorCode);
      assert.match(result.error ?? "", sentence, serverErrorCode);
      assert.equal(result.errorCode, serverErrorCode);
    }
  });

  it("does not send an occupant refusal to reload the page, as a wiring refusal does", () => {
    // The two are both 409s on the same endpoint and the advice is opposite: the season has moved
    // under a wiring refusal, and has not moved at all under an occupant one.
    const wiring = toActionErrorResult(new APIBadStatusError({ ...write, message: "bad", statusCode: 409, serverErrorCode: "REQ-WIRING-001" }));
    const occupant = toActionErrorResult(
      new APIBadStatusError({ ...write, message: "bad", statusCode: 409, serverErrorCode: "REQ-ELIGIBILITY-001" }),
    );

    assert.match(wiring.error ?? "", /Lade die Seite neu/);
    assert.doesNotMatch(occupant.error ?? "", /Lade die Seite neu/);
  });

  it("sends the seeding refusal to change the origin, never to reload", () => {
    // The two wiring codes are 409s from one function and their advice is opposite: a reload rebuilds
    // a form that never offered the shape, and only closes the answer behind this one.
    const result = toActionErrorResult(new APIBadStatusError({ ...write, message: "bad", statusCode: 409, serverErrorCode: "REQ-WIRING-002" }));

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
    const result = toActionErrorResult(new APIBadStatusError({ ...write, message: "bad", statusCode: 409, serverErrorCode: "REQ-WIRING-003" }));

    assert.equal(result.success, false);
    assert.match(result.error ?? "", /Gruppe/);
    assert.match(result.error ?? "", /Lade die Seite neu/);
    // No side rides back: the failure body names none, so a form placing this on one would guess.
    assert.equal(result.errorCode, undefined);
  });

  it("maps a 404 onto the vanished-record message", () => {
    const result = toActionErrorResult(new APIBadStatusError({ ...write, message: "bad", statusCode: 404 }));

    assert.match(result.error ?? "", /nicht gefunden/);
  });

  // A POST that only keeps an address or a token out of the URL changed nothing, so it fails as a
  // read does and trying it again is the repair.
  it("distinguishes a read that timed out from an unreachable server", () => {
    for (const sent of READS) {
      const timeout = toActionErrorResult(new APINetworkError({ ...base, ...sent, message: "t", isTimeout: true }));
      const down = toActionErrorResult(new APINetworkError({ ...base, ...sent, message: "d", isTimeout: false }));

      assert.match(timeout.error, /zu lange nicht geantwortet/, sent.method);
      assert.match(down.error, /nicht erreichbar/, sent.method);
      assert.deepEqual([timeout.outcome, down.outcome], [undefined, undefined], sent.method);
    }
  });

  // The frontend stopped waiting, or the connection broke after the send: a write may land either
  // way, and "try again" then repeats it, as it would a commit whose answer was lost.
  it("says a write whose answer never arrived is of unknown outcome, as a lost commit is", () => {
    for (const method of ["POST", "PATCH", "PUT", "DELETE"]) {
      for (const isTimeout of [true, false]) {
        const result = toActionErrorResult(new APINetworkError({ ...base, method, readOnly: false, message: "t", isTimeout }));

        assert.equal(result.error, "Ob die Änderung gespeichert wurde, ist unklar. Lade die Seite neu und prüfe, ob sie da ist.", method);
        assert.equal(result.outcome, "unknown", `${method}, timed out: ${String(isTimeout)}`);
      }
    }
  });

  it("maps a read's malformed data onto its own message", () => {
    for (const sent of READS) {
      const result = toActionErrorResult(new APIMalformedDataError({ ...base, ...sent, message: "m", statusCode: 200 }));

      assert.match(result.error, /fehlerhaft/, sent.method);
      assert.equal(result.outcome, undefined, sent.method);
    }
  });

  // A 2xx says the write landed, and only its answer is unreadable: "try again" repeats it.
  it("says a write whose answer failed its schema is of unknown outcome", () => {
    const result = toActionErrorResult(new APIMalformedDataError({ ...write, message: "m", statusCode: 200 }));

    assert.equal(result.outcome, "unknown");
  });

  // An error of this application's own code carries no request: the one its caller answered decides.
  it("says an unknown throw answering a write is of unknown outcome, and one answering a read a failure", () => {
    assert.equal(toActionErrorResult(new Error("anything"), { method: "POST", readOnly: false }).outcome, "unknown");
    for (const sent of READS) {
      assert.equal(toActionErrorResult(new Error("anything"), sent).outcome, undefined, sent.method);
    }
    assert.equal(toActionErrorResult(new Error("anything")).outcome, undefined, "a caller naming no request");
  });

  // Thrown before the commit of a transaction that then rolled back, the write is known not to stand.
  it("answers a write's proven rollback as the failure it is", () => {
    const result = toActionErrorResult(new RolledBackError(new Error("anything")), { method: "POST", readOnly: false });

    assert.equal(result.outcome, undefined);
    assert.equal(result.error, "Lade die Seite neu und versuche es erneut.");
  });

  it("never lets an unknown throw escape without a result", () => {
    const result = toActionErrorResult(new Error("anything"));

    assert.equal(result.success, false);
    assert.equal(typeof result.error, "string");
  });
});
