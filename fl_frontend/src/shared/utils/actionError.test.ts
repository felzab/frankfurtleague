import { readFileSync } from "node:fs";
import path from "node:path";

import { publishedOperations } from "@/test-support/openapiDocument.ts";
import { bodyField, refusedPayload } from "@/test-support/refusedPayload.ts";
import { assert, describe, expect, it } from "vitest";
import { z } from "zod";

import { APIBadStatusError, APINetworkError, isRefusalCode, RolledBackError } from "@/core/errors.ts";

import {
  EDGE_REFUSAL_BODY,
  FELD_ABGELEHNT,
  HEUTE_GENUG_GEAENDERT,
  isRuleRefusal,
  outcomeUnknown,
  refusedDraftAnswer,
  rejectedWrite,
  toActionErrorResult,
  unansweredAction,
  ZU_VIELE_VERSUCHE_NICHTS_GESPEICHERT,
  ZUGANG_WEG,
} from "./actionError.ts";
import { UNKNOWN_REFUSAL } from "./refusal.ts";
import { VALIDATION_FAILED } from "./validation.ts";

const base = { url: "http://backend:8000/api/v0/x", endpoint: "/x", traceId: "ab".repeat(16) };

/** An editor's save, the request every refusal here answers unless a case names another. */
const write = { ...base, method: "PATCH", readOnly: false };

/** The two requests that change nothing: a safe method, and a POST its caller declared read-only. */
const READS = [
  { method: "GET", readOnly: false },
  { method: "POST", readOnly: true },
] as const;

describe("toActionErrorResult", () => {
  /* The backend's actor check, ahead of every handler: the grant went between the guard and the call, so
     the server-error fallback's retry would be refused again and a sign-in restores nothing. */
  it("tells an administrator whose grant is gone so, for a write and a read alike", () => {
    for (const sent of [write, ...READS.map((read) => ({ ...base, ...read }))]) {
      const result = toActionErrorResult(new APIBadStatusError({ ...sent, message: "bad", statusCode: 403, serverErrorCode: "REQ-AUTH-006" }));

      expect(result, sent.method).toStrictEqual({ success: false, error: ZUGANG_WEG });
    }
  });

  /* Raised before the write on every person's route, so nothing was written; a retry meets the same count
     until German midnight, which is why the server error's retry is never offered. */
  it("tells a person at their day's ceiling to come back tomorrow, at any status the code arrives at", () => {
    for (const statusCode of [429, 409]) {
      const result = toActionErrorResult(
        new APIBadStatusError({ ...write, message: "bad", statusCode, serverErrorCode: "REQ-DROSSELUNG-001" }),
      );

      expect(result, String(statusCode)).toStrictEqual({ success: false, error: HEUTE_GENUG_GEAENDERT });
    }
  });

  it("maps a 409 onto the conflict message, not the generic one", () => {
    const result = toActionErrorResult(new APIBadStatusError({ ...write, message: "bad", statusCode: 409, serverErrorCode: "DB-COMMON-002" }));

    expect(result.success).toBe(false);
    expect(result.error ?? "").toMatch(/Konflikt/);
  });

  /* The unique index's sentence sends the admin looking for an entry that exists, which a rule refusing
     for any other reason leaves them searching for in vain. */
  it("answers a 409 no reader here words with the way out alone, never the unique index's conflict", () => {
    const result = toActionErrorResult(
      new APIBadStatusError({ ...write, message: "bad", statusCode: 409, serverErrorCode: "REQ-UNCLAIMED-000" }),
    );

    expect(result).toStrictEqual({ success: false, error: UNKNOWN_REFUSAL });
  });

  it("gives each occupant refusal its own advice, and hands the code back", () => {
    // The code is the only channel a 409's body has, so it has to
    // survive the mapping: the form turns it into a message on a specific side. A dropped
    // code falls back to a toast naming no field.
    const refusals: [string, RegExp][] = [
      ["REQ-ELIGIBILITY-001", /ausgeschieden/],
      ["REQ-ELIGIBILITY-002", /nimmt nicht an dieser Saison teil/],
      ["REQ-SPIELTAG-001", /selben Spieltag/],
    ];

    for (const [serverErrorCode, expected] of refusals) {
      const result = toActionErrorResult(new APIBadStatusError({ ...write, message: "bad", statusCode: 409, serverErrorCode }));

      expect(result.success, serverErrorCode).toBe(false);
      expect(result.error ?? "", serverErrorCode).toMatch(expected);
      expect(result.errorCode).toBe(serverErrorCode);
    }
  });

  it("says a commit of unknown outcome is unclear rather than failed", () => {
    // A failure message sends the admin to repeat a write that may already stand.
    const result = toActionErrorResult(new APIBadStatusError({ ...write, message: "bad", statusCode: 500, serverErrorCode: "DB-FAIL-002" }));

    expect(result.error).toBe("Ob die Änderung gespeichert wurde, ist unklar. Lade die Seite neu und prüfe, ob sie da ist.");
    // The marker `appToast.failure` titles the toast by: the site's own title says the change did not happen.
    expect(result.outcome).toBe("unknown");
  });

  it("keeps the one code saying the write failed a failure", () => {
    // Titled unclear, it sends the admin to look for a change `DB-FAIL-001` says is not there.
    const result = toActionErrorResult(new APIBadStatusError({ ...write, message: "bad", statusCode: 500, serverErrorCode: "DB-FAIL-001" }));

    expect(result.outcome).toBe(undefined);
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

      expect(result.error, String(statusCode)).toBe(
        "Ob die Änderung gespeichert wurde, ist unklar. Lade die Seite neu und prüfe, ob sie da ist.",
      );
      expect(result.outcome, String(statusCode)).toBe("unknown");
    }
  });

  it("keeps a read's server error the retry it is", () => {
    for (const sent of READS) {
      const result = toActionErrorResult(
        new APIBadStatusError({ ...base, ...sent, message: "bad", statusCode: 500, serverErrorCode: "SRV-FAIL-001" }),
      );

      expect(result.error, sent.method).toBe("Der Server hat mit einem Fehler geantwortet. Versuche es erneut.");
      expect(result.outcome, sent.method).toBe(undefined);
    }
  });

  it("reads the occupant table with `hasOwn`, so a code named for a prototype key is not a refusal", () => {
    // `serverErrorCode` is `String(body.error_code)` off the response with nothing narrowing it
    // (`fl_frontend/src/core/api.ts`), so `in` would select `Object.prototype.toString` — a function,
    // where every caller is promised German.
    for (const serverErrorCode of ["toString", "constructor", "valueOf"]) {
      const result = toActionErrorResult(new APIBadStatusError({ ...write, message: "bad", statusCode: 409, serverErrorCode }));

      // No rule's code either, so the answer is the unexplained failure's sentence.
      expect(result.error, serverErrorCode).toBe("Der Server hat mit einem Fehler geantwortet. Versuche es erneut.");
      expect(result.errorCode, serverErrorCode).toBe(undefined);
    }
  });

  it("keeps the two rail-backed refusals to one sentence about the value", () => {
    // Their remedies are pinned where they
    // live, in `AdminEditSpielDataForm/banners.test.ts`: a shared module may not reach a feature.
    for (const serverErrorCode of ["REQ-ELIGIBILITY-001", "REQ-SPIELTAG-001"]) {
      const result = toActionErrorResult(new APIBadStatusError({ ...write, message: "bad", statusCode: 409, serverErrorCode }));

      expect(result.error?.split(". ").length, serverErrorCode).toBe(1);
      expect(result.error ?? "", serverErrorCode).not.toMatch(/Hebe den Austritt auf|Ändere dort die Herkunft/);
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

      expect(result.error ?? "", serverErrorCode).not.toMatch(/Konflikt/);
      expect(result.error ?? "", serverErrorCode).toMatch(sentence);
      expect(result.errorCode).toBe(serverErrorCode);
    }
  });

  it("does not send an occupant refusal to reload the page, as a wiring refusal does", () => {
    // The two are both 409s on the same endpoint and the advice is opposite: the season has moved
    // under a wiring refusal, and has not moved at all under an occupant one.
    const wiring = toActionErrorResult(new APIBadStatusError({ ...write, message: "bad", statusCode: 409, serverErrorCode: "REQ-WIRING-001" }));
    const occupant = toActionErrorResult(
      new APIBadStatusError({ ...write, message: "bad", statusCode: 409, serverErrorCode: "REQ-ELIGIBILITY-001" }),
    );

    expect(wiring.error ?? "").toMatch(/Lade die Seite neu/);
    expect(occupant.error ?? "").not.toMatch(/Lade die Seite neu/);
  });

  it("sends the seeding refusal to change the origin, never to reload", () => {
    // The two wiring codes are 409s from one function and their advice is opposite: a reload rebuilds
    // a form that never offered the shape, and only closes the answer behind this one.
    const result = toActionErrorResult(new APIBadStatusError({ ...write, message: "bad", statusCode: 409, serverErrorCode: "REQ-WIRING-002" }));

    expect(result.success).toBe(false);
    expect(result.error ?? "").not.toMatch(/Lade die Seite neu/);
    expect(result.error ?? "").toMatch(/Herkunft/);
    expect(result.error ?? "").toMatch(/ersten KO-Runde/);
    expect(result.error?.split(". ").length).toBe(2);
    expect(result.error?.split(". ")[1] ?? "").toMatch(/^Wähle/);
    // No side rides back: the failure body names none, so a form placing this on one would guess.
    expect(result.errorCode).toBe(undefined);
  });

  it("sends the unrun-group refusal to reload, and names the group as the fault", () => {
    // Unlike the seeding refusal above: the picker offers only the season's groups, so this code
    // arriving means the season was redrawn narrower under the open form, and a reload renews it.
    const result = toActionErrorResult(new APIBadStatusError({ ...write, message: "bad", statusCode: 409, serverErrorCode: "REQ-WIRING-003" }));

    expect(result.success).toBe(false);
    expect(result.error ?? "").toMatch(/Gruppe/);
    expect(result.error ?? "").toMatch(/Lade die Seite neu/);
    // No side rides back: the failure body names none, so a form placing this on one would guess.
    expect(result.errorCode).toBe(undefined);
  });

  it("maps a 404 onto the vanished-record message", () => {
    const result = toActionErrorResult(new APIBadStatusError({ ...write, message: "bad", statusCode: 404, serverErrorCode: "DB-COMMON-001" }));

    expect(result.error ?? "").toMatch(/nicht gefunden/);
  });

  // A POST that only keeps an address or a token out of the URL changed nothing, so it fails as a
  // read does and trying it again is the repair.
  it("distinguishes a read that timed out from an unreachable server", () => {
    for (const sent of READS) {
      const timeout = toActionErrorResult(new APINetworkError({ ...base, ...sent, message: "t", isTimeout: true }));
      const down = toActionErrorResult(new APINetworkError({ ...base, ...sent, message: "d", isTimeout: false }));

      expect(timeout.error, sent.method).toMatch(/zu lange nicht geantwortet/);
      expect(down.error, sent.method).toMatch(/nicht erreichbar/);
      expect([timeout.outcome, down.outcome], sent.method).toStrictEqual([undefined, undefined]);
    }
  });

  // The frontend stopped waiting, or the connection broke after the send: a write may land either
  // way, and "try again" then repeats it, as it would a commit whose answer was lost.
  it("says a write whose answer never arrived is of unknown outcome, as a lost commit is", () => {
    for (const method of ["POST", "PATCH", "PUT", "DELETE"]) {
      for (const isTimeout of [true, false]) {
        const result = toActionErrorResult(new APINetworkError({ ...base, method, readOnly: false, message: "t", isTimeout }));

        expect(result.error, method).toBe("Ob die Änderung gespeichert wurde, ist unklar. Lade die Seite neu und prüfe, ob sie da ist.");
        expect(result.outcome, `${method}, timed out: ${String(isTimeout)}`).toBe("unknown");
      }
    }
  });

  // An error of this application's own code carries no request: the one its caller answered decides.
  it("says an unknown throw answering a write is of unknown outcome, and one answering a read a failure", () => {
    expect(toActionErrorResult(new Error("anything"), { method: "POST", readOnly: false }).outcome).toBe("unknown");
    for (const sent of READS) {
      expect(toActionErrorResult(new Error("anything"), sent).outcome, sent.method).toBe(undefined);
    }
    expect(toActionErrorResult(new Error("anything")).outcome, "a caller naming no request").toBe(undefined);
  });

  // Thrown before the commit of a transaction that then rolled back, the write is known not to stand.
  it("answers a write's proven rollback as the failure it is", () => {
    const result = toActionErrorResult(new RolledBackError(new Error("anything")), { method: "POST", readOnly: false });

    expect(result.outcome).toBe(undefined);
    expect(result.error).toBe("Lade die Seite neu und versuche es erneut.");
  });

  it("never lets an unknown throw escape without a result", () => {
    const result = toActionErrorResult(new Error("anything"));

    expect(result.success).toBe(false);
    expect(typeof result.error).toBe("string");
  });
});

describe("a refusal read by its code, whatever its status", () => {
  const refused = (statusCode: number, serverErrorCode: string | undefined, refusedFields: Parameters<typeof refusedPayload>[0] = []) =>
    toActionErrorResult(new APIBadStatusError({ ...write, message: "bad", statusCode, serverErrorCode, refusedFields }));

  /* Codes are unique across the API, so a rule moved off 409 keeps the words its code is given here. */
  it("keeps each worded code's answer at any status a rule answers with", () => {
    for (const code of ["REQ-WIRING-001", "REQ-WIRING-002", "REQ-WIRING-003", "REQ-STATE-002", "REQ-ELIGIBILITY-001", "DB-COMMON-002"]) {
      for (const status of [422, 404, 410, 403])
        expect(refused(status, code), `${String(code)} at ${String(status)}`).toStrictEqual(refused(409, code));
    }
  });

  it("answers a rule no reader here words with the way out alone, at any status a rule answers with", () => {
    for (const status of [422, 404, 410, 403]) {
      expect(refused(status, "REQ-UNCLAIMED-000"), String(status)).toStrictEqual({ success: false, error: UNKNOWN_REFUSAL });
    }
  });

  it("marks the box a rule's refusal names, with the way out for the rest", () => {
    expect(refused(422, "REQ-UNCLAIMED-000", [bodyField(["geburtsdatum"], "REQ-UNCLAIMED-000")])).toStrictEqual({
      success: false,
      error: VALIDATION_FAILED,
      fieldErrors: { geburtsdatum: FELD_ABGELEHNT },
      unplacedError: UNKNOWN_REFUSAL,
    });
  });

  /* A body the API cannot decode answers 400 under a code of its own. A retry would send the same
     bytes, so it takes the refused payload's reload rather than the server error's retry. */
  it("answers the unreadable body as it answers the refused payload", () => {
    expect(refused(400, "REQ-VAL-002")).toStrictEqual(refused(422, "REQ-VAL-001"));
    expect(refused(400, "REQ-VAL-002").error).toBe("Einzelne Angaben wurden nicht übernommen. Lade die Seite neu.");
  });

  /* None of these refuses what the admin asked for, so none takes a rule's fallback. */
  it("answers a vanished record, a refused request and a refused credential on their own terms", () => {
    expect(refused(404, "DB-COMMON-001").error).toMatch(/nicht gefunden/);
    // A route the framework did not serve, or one no code names at all, is never a record the API says
    // is gone, nor a rule's refusal: a page older or newer than the API meets these mid-deploy.
    for (const [status, code] of [
      [400, "REQ-AUTH-005"],
      [401, "REQ-AUTH-002"],
      [404, undefined],
      [404, "REQ-ROUTE-001"],
      [405, "REQ-ROUTE-002"],
      [409, undefined],
    ] as const) {
      expect(refused(status, code).error, `${String(code)} at ${String(status)}`).toBe(
        "Der Server hat mit einem Fehler geantwortet. Versuche es erneut.",
      );
    }
  });

  /* By the class alone: each protocol class keeps any code the backend adds to it, and only a rule's
     code or the unique index's is ever a refusal a mapper words. */
  it("classifies a code by its class, whatever it is numbered", () => {
    for (const code of [
      "REQ-AUTH-005",
      "REQ-VAL-001",
      "REQ-VAL-002",
      "REQ-ROUTE-001",
      "REQ-DROSSELUNG-001",
      "DB-COMMON-001",
      "DB-CONN-001",
      "SRV-FAIL-001",
    ]) {
      expect(isRefusalCode(code), code).toBe(false);
    }
    for (const code of ["REQ-SWAP-007", "REQ-BEWERBUNG-009", "REQ-UNCLAIMED-000", "DB-COMMON-002"])
      expect(isRefusalCode(code), code).toBe(true);
    expect(isRefusalCode(undefined)).toBe(false);
  });

  /* The harness reads the same predicate, so this asks the document itself: every code it publishes at
     a 4xx is a refusal exactly where the predicate says so, at the status it is published under. */
  it("reads a published refusal as a rule's at its published status, and nothing else", () => {
    const answers = publishedOperations().flatMap(({ operation, answers: published }) => published.map((answer) => ({ operation, ...answer })));
    assert.ok(answers.some(({ code }) => isRefusalCode(code)) && answers.some(({ code }) => !isRefusalCode(code)), "one class is missing");

    for (const { operation, code, status } of answers.filter(({ status: published }) => published < 500)) {
      const refusal = new APIBadStatusError({ ...write, message: "bad", statusCode: status, serverErrorCode: code });
      expect(isRuleRefusal(refusal), `${code} at ${String(status)} on ${operation}`).toBe(isRefusalCode(code));
    }
  });

  /* A write a 5xx answered may have landed, and a refusal's words would say it did not. */
  it("never words a server error by the code it carries", () => {
    for (const code of ["REQ-WIRING-001", "REQ-STATE-002", "DB-COMMON-002", "REQ-UNCLAIMED-000"]) {
      expect(refused(500, code).outcome, code).toBe("unknown");
    }
  });
});

describe("a payload the API refused", () => {
  const refused = (fields: Parameters<typeof refusedPayload>[0]) => toActionErrorResult(refusedPayload(fields));

  /* The address box's own messages describe rules the value already passed, so the box says only
     that this value was not taken; the path is the input's `name`, which `Form` distributes by. */
  it("lands on the box the refusal names, keyed by its dotted path", () => {
    const result = refused([bodyField(["kontakt", "email"])]);

    expect(result).toStrictEqual({
      success: false,
      error: VALIDATION_FAILED,
      // Spelled out once: the sentence is ruled, and every other case reads the constant.
      fieldErrors: { "kontakt.email": "Diese Angabe wurde so nicht übernommen." },
      unplacedError: "Einzelne Angaben wurden nicht übernommen. Lade die Seite neu.",
    });
  });

  it("names a list entry by its index, as the entry's input is named", () => {
    const result = refused([bodyField(["namen", 1, "vorname"], "string_pattern_mismatch")]);

    expect(result.fieldErrors).toStrictEqual({ "namen.1.vorname": FELD_ABGELEHNT });
  });

  it("keeps the failure naming no field where nothing it names is inside the body, and answers the reload", () => {
    const result = refused([
      { in: "query", path: ["limit"], kind: "int_parsing" },
      { in: "body", path: [], kind: "json_invalid" },
    ]);

    // No control carries a query parameter or the body as a whole, so a map holding either would be
    // announced as a refusal the form cannot show rather than as the failure it is.
    expect(result.fieldErrors).toBe(undefined);
    // The running API refuses the request as sent, so a retry sends it again and a reload is the repair.
    expect(result.error).toBe("Einzelne Angaben wurden nicht übernommen. Lade die Seite neu.");
  });
});

describe("a public route's own parse refusing the body", () => {
  const SATZ = "Der Satz der Seite.";
  const refusal = (body: unknown) => {
    const parsed = z.object({ vorname: z.string() }).safeParse(body);
    expect(parsed.success, "the probe body parsed").toBe(false);

    return refusedDraftAnswer(parsed.error ?? assert.fail(), SATZ);
  };

  it("carries the page's sentence beside the map, for a path no control on an older page renders", () => {
    const answer = refusal({ vorname: 7 });

    assert.ok("fieldErrors" in answer, "a refusal naming a path came back with no map");
    expect(Object.keys(answer.fieldErrors)).toStrictEqual(["vorname"]);
    expect(answer.unplacedError).toBe(SATZ);
  });

  it("answers the sentence alone where the refusal names no path, which no control could mark", () => {
    expect(refusal("kein Objekt")).toStrictEqual({ error: SATZ });
  });
});

describe("a write action that rejected", () => {
  /* No answer came back, so no server refresh did either, while the write may stand. */
  it("reads the page again and answers as of unknown outcome, in the control's own words where it has them", () => {
    let refreshed = 0;
    const router = { refresh: () => void (refreshed += 1) };

    const dropped = new Error("An unexpected response was received from the server.");
    expect(rejectedWrite(router)(dropped)).toStrictEqual(outcomeUnknown());
    expect(rejectedWrite(router, "Prüfe die Verbindung.")(dropped)).toStrictEqual({ ...outcomeUnknown(), error: "Prüfe die Verbindung." });
    expect(refreshed, "a rejected write left the page as it was").toBe(2);
  });

  /* As Next's action client raises it: the body of a non-RSC answer under exactly `text/plain` becomes the
     error's message. Anything else it raises carries its own generic message, which stays unclear. */
  it("says nothing was saved where the edge refused the press, reading nothing again", () => {
    let refreshed = 0;
    const router = { refresh: () => void (refreshed += 1) };
    const edge = new Error(EDGE_REFUSAL_BODY);
    const refused = { success: false, error: ZU_VIELE_VERSUCHE_NICHTS_GESPEICHERT };

    expect(unansweredAction(edge)).toStrictEqual(refused);
    expect(unansweredAction(edge, "Prüfe die Verbindung.")).toStrictEqual(refused);
    expect(rejectedWrite(router)(edge)).toStrictEqual(refused);
    expect(rejectedWrite(router, "Prüfe die Verbindung.")(edge)).toStrictEqual(refused);
    expect(refreshed, "a press the edge refused wrote nothing to read again").toBe(0);

    for (const other of [
      new Error("An unexpected response was received from the server."),
      new Error(`${EDGE_REFUSAL_BODY}\n`),
      EDGE_REFUSAL_BODY,
    ]) {
      expect(unansweredAction(other), String(other)).toStrictEqual(outcomeUnknown());
    }
  });

  /* Source text rather than a served answer: `nginx/edge_test.sh` serves the file and grades the body
     against this same line, so the two halves meet at it. */
  it("expects the very sentence the edge returns, in ASCII alone", () => {
    const site = readFileSync(path.resolve(import.meta.dirname, "..", "..", "..", "..", "nginx", "shared", "site.conf"), "utf8");
    const returned = [...site.matchAll(/^\s*return 429 "(.*)";$/gm)].map((match) => match[1]);

    expect(returned).toStrictEqual([EDGE_REFUSAL_BODY]);
    expect(EDGE_REFUSAL_BODY).toMatch(/^[ -~]+$/);
  });
});
