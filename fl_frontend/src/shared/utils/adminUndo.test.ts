import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { cacheCalls, doubleActionRequest } from "@/shared/testing/actionDoubles.ts";

import type { UndoOutcome } from "./adminUndo.ts";

/* The session, the refresh and the trace seed are the framework's, and the spine between them and the
   undo's body is what is driven. */
const { setSession, setRefusal } = doubleActionRequest();

const { partlyRestored, refusedReplay, replayRefusal, restored, runAdminUndo, unclearReplay } = await import("./adminUndo.ts");
const { invalidatesOnWrite, FORBIDDEN_BY_REFUSAL, runAdminMutation } = await import("./adminMutation.ts");
const { AENDERUNG_STEHT_WEITERHIN, ZUGANG_WEG } = await import("./actionError.ts");
const { APIBadStatusError, APIMalformedDataError, APINetworkError } = await import("@/core/errors.ts");
const { recordWriteSent } = await import("@/core/requestScope.ts");
const { bodyField } = await import("@/shared/testing/refusedPayload.ts");
const { UNKNOWN_REFUSAL } = await import("./refusal.ts");

/** The ruling's words for an undo nobody can tell landed. */
const RUECKNAHME_UNKLAR = "Ob die Änderung zurückgenommen wurde, ist unklar. Lade die Seite neu und prüfe sie.";

/** What the spine and the undo did to the caches and the page, by call. */
const cleared = (): string[] => cacheCalls.map(({ name, args }) => [name, ...args].join(" "));

/** A replay that declares a tag and, where `sent`, sends its write, then answers or throws as `replay` does. */
const body = (replay: () => Promise<UndoOutcome>, sent: boolean) => () => {
  invalidatesOnWrite("probe");
  if (sent) recordWriteSent();
  return replay();
};

/** One undo over that replay. */
const undo = (replay: () => Promise<UndoOutcome>, sent = true) => runAdminUndo("undoProbe", body(replay, sent));

/** The same replay as a save's body, on the spine every admin save runs on. */
const save = (replay: () => Promise<UndoOutcome>, sent = true) => runAdminMutation("saveProbe", body(replay, sent));

/** A replayed endpoint's failure, answered as `apiClient` raises it, naming the body fields `refusedFields` names. */
const failed = (statusCode: number, serverErrorCode: string, refusedFields: ReturnType<typeof bodyField>[] = []) =>
  new APIBadStatusError({
    message: "refused",
    url: "http://backend:8000/api/v0/x",
    endpoint: "/x",
    method: "PATCH",
    readOnly: false,
    traceId: "ab".repeat(16),
    statusCode,
    serverErrorCode,
    refusedFields,
  });

const TABLE = { "REQ-TEST-001": "Die Rücknahme wurde nicht ausgeführt." };
const HALF = "Nur die Stammdaten wurden zurückgesetzt.";
const SECOND_HALF = { unworded: "Die Saison-Zugehörigkeit lässt sich so nicht mehr zurücksetzen.", restored: HALF };

/** A read an undo makes before its write, failing as `apiClient` raises it: nothing was sent. */
const READ = { url: "http://backend:8000/api/v0/x", endpoint: "/x", method: "GET", readOnly: false, traceId: "ab".repeat(16) };

/** Each failure after which a save's press may pass again, by its reason, with whether the undo had sent its write. */
const PRESS_AGAIN = [
  { failure: failed(500, "DB-FAIL-001"), sent: true, reason: "Der Server hat mit einem Fehler geantwortet.", retry: "Versuche es erneut." },
  {
    failure: new APINetworkError({ ...READ, message: "timed out", isTimeout: true }),
    sent: false,
    reason: "Der Server hat zu lange nicht geantwortet.",
    retry: "Versuche es erneut.",
  },
  {
    failure: new APINetworkError({ ...READ, message: "refused", isTimeout: false }),
    sent: false,
    reason: "Der Server ist gerade nicht erreichbar.",
    retry: "Versuche es später erneut.",
  },
  {
    failure: new APIMalformedDataError({ ...READ, message: "malformed", statusCode: 200 }),
    sent: false,
    reason: "Die Daten kamen fehlerhaft an.",
    retry: "Versuche es erneut.",
  },
];

/** Each failure naming no cause, with whether the undo had sent its write. */
const UNNAMED = [
  { what: "a rule no table words", failure: failed(409, "REQ-TEST-002"), sent: true },
  { what: "a rule no table words, over a field", failure: failed(422, "REQ-TEST-002", [bodyField(["gruppe"])]), sent: true },
  { what: "a throw of this application's own", failure: new Error("unnamed"), sent: false },
];

/** What the offer's toast shows of a failure: the sentence no box takes, where the refusal marks fields. */
const shown = (answer: UndoOutcome): string => (answer.success ? "" : (answer.unplacedError ?? answer.error));

describe("what the undo spine clears behind each answer", () => {
  /* One write refused wrote nothing, so no cached read moved and the page is left as it stands: a
     refresh can remount an editor keyed on its row, dropping typing a refusal never touched. */
  it("clears nothing and reads nothing again behind a refusal of the replay's one write", async () => {
    const answer = await undo(async () => refusedReplay(failed(409, "REQ-TEST-001"), TABLE));

    assert.deepEqual(answer, { success: false, error: `${TABLE["REQ-TEST-001"]} ${AENDERUNG_STEHT_WEITERHIN}` });
    assert.deepEqual(cleared(), []);
  });

  /* The defect a cached club or person keeps serving for days: the half that went back moved its reads,
     whether its second write was refused by a rule or failed outright. */
  it("clears the caches and reads the page again behind a half that went back, refused or failed", async () => {
    for (const second of [failed(409, "REQ-TEST-001"), failed(500, "DB-FAIL-001")]) {
      cacheCalls.length = 0;
      const answer = await undo(async () => partlyRestored(second, TABLE, SECOND_HALF));

      assert.equal(answer.success, false);
      assert.equal(answer.success ? undefined : answer.outcome, "partial", `${String(second.serverErrorCode)} was not marked partly restored`);
      assert.ok(!answer.success && answer.error.endsWith(` ${HALF}`), `${String(second.serverErrorCode)} names no half that went back`);
      assert.deepEqual(cleared(), ["updateTag probe", "refresh"], `${String(second.serverErrorCode)} left the restored half's reads standing`);
    }
  });

  /* No form stands behind an undo, so the marks a refusal puts on the fields it names have no box: the
     sentence for the rest is the answer, never the form's „Überprüfe Deine Eingaben.“ */
  it("answers a second write refused over fields in the sentence no box takes, then the half that went back", async () => {
    const sentences = {
      "REQ-TEST-002": SECOND_HALF.unworded,
      "REQ-VAL-001": "Einzelne Angaben wurden nicht übernommen. Lade die Seite neu.",
    };
    for (const [code, sentence] of Object.entries(sentences)) {
      const answer = await undo(async () => partlyRestored(failed(422, code, [bodyField(["gruppe"])]), TABLE, SECOND_HALF));

      assert.deepEqual(answer, { success: false, error: `${sentence} ${HALF}`, outcome: "partial" }, code);
    }
  });

  /* A failure that may have landed is no half restored: it is rethrown, so the spine titles it unclear. */
  it("answers a second write that may have landed as unclear, never as partly restored", async () => {
    const answer = await undo(async () => partlyRestored(failed(500, "DB-FAIL-002"), TABLE, SECOND_HALF));

    assert.deepEqual(answer, { success: false, error: RUECKNAHME_UNKLAR, outcome: "unknown" });
    assert.deepEqual(cleared(), ["updateTag probe", "refresh"]);
  });
});

describe("what the undo spine answers when nobody can tell whether its replay landed", () => {
  /* A throw after the replay's write may have restored the row, so it is unclear, in words about the
     undo. Already of unknown outcome, it cannot catch a definite failure losing its partial outcome. */
  it("answers a throw of the replay's own code after its write as unclear, in words about the undo, and clears", async () => {
    const answer = await undo(async () => {
      throw new RangeError("Invalid time value");
    });

    assert.deepEqual(answer, { success: false, error: RUECKNAHME_UNKLAR, outcome: "unknown" });
    assert.deepEqual(cleared(), ["updateTag probe", "refresh"], "a replay that threw leaves the caches serving the rows it had written");
  });

  /* An unacknowledged write may still have landed too, and the slice's own sentence says what to check. */
  it("answers an unacknowledged replay as of unknown outcome, in the slice's own sentence", async () => {
    const answer = await undo(async () => unclearReplay("Die Rücknahme wurde abgebrochen. Prüfe den Eintrag."));

    assert.deepEqual(answer, { success: false, error: "Die Rücknahme wurde abgebrochen. Prüfe den Eintrag.", outcome: "unknown" });
    assert.deepEqual(cleared(), ["updateTag probe", "refresh"], "a write that may have landed leaves the caches serving what it replaced");
  });

  it("answers a restore that cost something with the restored sentence first, graded a warning", async () => {
    assert.deepEqual(await undo(async () => restored()), { success: true, message: "Die Änderung wurde zurückgenommen.", warn: false });
    assert.deepEqual(await undo(async () => restored("Ein Link ging raus.")), {
      success: true,
      message: "Die Änderung wurde zurückgenommen. Ein Link ging raus.",
      warn: true,
    });
  });
});

describe("what an undo says where a save offers its press again", () => {
  /* The press clears the offer and nothing raises it again, so the undo says what became of the change
     where a save, whose form stays open, offers the same press again. */
  for (const { failure, sent, reason, retry } of PRESS_AGAIN) {
    it(`says the change stands after „${reason}“, where a save retries`, async () => {
      assert.deepEqual(await undo(() => Promise.reject(failure), sent), { success: false, error: `${reason} ${AENDERUNG_STEHT_WEITERHIN}` });
      assert.deepEqual(await save(() => Promise.reject(failure), sent), { success: false, error: `${reason} ${retry}` });
    });
  }

  /* No rule's reason can be named, and a reload would only show the change standing. */
  for (const { what, failure, sent } of UNNAMED) {
    it(`names no cause after ${what} and says the change stands, where a save retries`, async () => {
      assert.equal(
        shown(await undo(() => Promise.reject(failure), sent)),
        `Die Rücknahme ist so nicht mehr möglich. ${AENDERUNG_STEHT_WEITERHIN}`,
      );
      assert.equal(shown(await save(() => Promise.reject(failure), sent)), UNKNOWN_REFUSAL);
    });
  }
});

describe("what an undo says where no press repairs its failure", () => {
  /* A grant gone by the time the backend judged the replay is the guard's own refusal arriving late: worded as the
     guard's, the change standing (`docs/frontend/spec.md :: I522`), where a save says the cause alone. */
  it("says the change stands after a grant the backend found gone, as the guard's refusal does", async () => {
    assert.deepEqual(await undo(() => Promise.reject(failed(403, "REQ-AUTH-006")), false), {
      success: false,
      error: `${ZUGANG_WEG} ${AENDERUNG_STEHT_WEITERHIN}`,
    });
    assert.deepEqual(await save(() => Promise.reject(failed(403, "REQ-AUTH-006")), false), { success: false, error: ZUGANG_WEG });
  });

  /* A save's page asks the passkey on its next press; the undo's offer is gone once pressed, so asking for a
     confirmation first would point at a press nobody can make. */
  it("says the confirmation lapsed and the change stands, where a save asks for the confirmation", async () => {
    assert.deepEqual(await undo(() => Promise.reject(failed(403, "REQ-AUTH-009")), false), {
      success: false,
      error: `Deine Bestätigung mit dem Passkey ist abgelaufen. ${AENDERUNG_STEHT_WEITERHIN}`,
      stepUp: true,
    });
    assert.deepEqual(await save(() => Promise.reject(failed(403, "REQ-AUTH-009")), false), {
      success: false,
      error: "Bestätige zuerst, dass Du es bist.",
      stepUp: true,
    });
  });
});

describe("who the undo spine answers before it does any work", () => {
  /* Each reason in the action's own words, so the save and its undo never word one condition two ways,
     and then that the change stands: the offer pressed is gone, so no retry is offered either. */
  it("answers every reason its guard turns a caller away for in the action's sentence, never a retry, and that the change stands", async () => {
    for (const [reason, sentence] of Object.entries(FORBIDDEN_BY_REFUSAL)) {
      setSession(null);
      setRefusal(reason as keyof typeof FORBIDDEN_BY_REFUSAL);
      cacheCalls.length = 0;
      let ran = 0;

      const answer = await runAdminUndo("undoProbe", async () => {
        ran += 1;
        return restored();
      });

      const cause = reason === "unread" ? "Dein Zugang zur Verwaltung ließ sich gerade nicht prüfen." : sentence;
      assert.deepEqual(answer, { success: false, error: `${cause} ${AENDERUNG_STEHT_WEITERHIN}` }, `the ${reason} arm`);
      assert.equal(ran, 0, `the ${reason} arm ran the replay`);
      assert.deepEqual(cacheCalls, [], `the ${reason} arm cleared a cache or read the page for a caller nobody authorized`);
    }
  });
});

describe("the sentence a replay's refusal is worded with", () => {
  /* Codes are unique across the API, so a rule moved to another status keeps its row. */
  it("answers the table's sentence for a refusal carrying one of its codes, at whatever status", () => {
    for (const status of [409, 422, 404, 410, 403]) {
      assert.equal(replayRefusal(failed(status, "REQ-TEST-001"), TABLE), TABLE["REQ-TEST-001"], String(status));
    }
  });

  // `undefined` is the action's cue to rethrow, so each of these reaches the spine as a failure.
  it("answers nothing for an unmapped code, a server error, or anything but a refusal", () => {
    assert.equal(replayRefusal(failed(409, "REQ-TEST-002"), TABLE), undefined, "an unmapped code was worded");
    // The replay may have landed behind a 5xx, which a refusal's "Die Änderung steht weiterhin." would deny.
    assert.equal(replayRefusal(failed(500, "REQ-TEST-001"), TABLE), undefined, "a server error was worded as a refusal");
    assert.equal(replayRefusal(new Error("network"), TABLE), undefined, "a thrown error that is no refusal was worded");
  });

  it("reads the table with `hasOwn`, so a code named for a prototype key is not a refusal", () => {
    assert.equal(replayRefusal(failed(409, "toString"), TABLE), undefined);
  });
});
