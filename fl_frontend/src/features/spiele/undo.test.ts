import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { cacheCalls, doubleActionRequest } from "@/shared/testing/actionDoubles.ts";
import { doubleApiAnswers } from "@/shared/testing/apiClientDouble.ts";
import { publishedRefusals, refusedOn, unpublishedOn } from "@/shared/testing/publishedRefusals.ts";
import { assertEachRefusalCloses, droppedTags, unacknowledged } from "@/shared/testing/undoActions.ts";

/** What `fl_frontend/src/features/spiele/mutations.ts :: patchAdminSpielePaarungen` sends, as the backend's own routes spell it. */
const REPLAY_OPERATION = "PATCH /spiele/paarungen";

/* The real client reaches a backend no test process runs, so it is the one module replaced here; the
   action, its mutation and the spine are the real ones, driven. */
const { setSession } = doubleActionRequest();

const { answerWith, calls } = doubleApiAnswers(() => Promise.resolve(RESTORED));

const { undoAdminSpielEditAction } = await import("./actions.ts");

const SAISON_ID = "2026";
const SPIEL_ID = "6890a1b2c3d4e5f607a10001";
const OTHER_SPIEL_ID = "6890a1b2c3d4e5f607a10002";

/** What every cached read of a season's fixtures is keyed under; a tag dropped here goes on serving what the undo took back. */
const EXPECTED_TAGS = ["spiele", "teams", `spiele:saison_id:${SAISON_ID}`, `teams:saison_id:${SAISON_ID}`];

const anEntry = (spiel_id: string) => ({
  spiel_id,
  team1: null,
  team2: null,
  elfmeterschiessen: null,
  sonderereignis: null,
  other_fields: null,
});

const RESTORED = { acknowledged: 1, advanced_to: [], released_sides: [], bracket_faults: [] };

const aReplayOf = (...ids: string[]) => ({ saison_id: SAISON_ID, paarungen: ids.map(anEntry) });

/** The sentence an answer carries, success or not, which a case matches against. */
const wordsOf = (answer: Awaited<ReturnType<typeof undoAdminSpielEditAction>>): string => (answer.success ? answer.message : answer.error);

describe("the undo's replay refusals against the endpoint it replays", () => {
  it("words every refusal the replayed endpoint publishes, closing on the change standing once", async () => {
    const answers = await assertEachRefusalCloses({
      codes: publishedRefusals(REPLAY_OPERATION),
      refuse: (code) => {
        answerWith(() => Promise.reject(refusedOn(REPLAY_OPERATION, code)));
      },
      press: () => undoAdminSpielEditAction(aReplayOf(SPIEL_ID)),
    });

    for (const [code, error] of answers) {
      // One replay carries several fixtures, so an answer pointing at one of them is wrong on the rest;
      // case-insensitive for the capital a sentence opens with.
      assert.doesNotMatch(error, /\b(?:dieses|diesem|das)\s+Spiels?\b/i, `${code} points at a single fixture`);
    }
  });
});

describe("the match save's undo, driven", () => {
  it("replays the whole body in one request to the endpoint those rules are declared against", async () => {
    const answered = await undoAdminSpielEditAction(aReplayOf(SPIEL_ID, OTHER_SPIEL_ID));

    assert.equal(answered.success, true);
    // ONE call for two fixtures: a call per entry is what let a stopped replay lose the rest.
    assert.equal(calls.length, 1);
    assert.deepEqual(
      calls.map((call) => [call.endpoint, call.method]),
      [["/spiele/paarungen", "PATCH"]],
    );

    const sent = JSON.parse(calls[0]?.body ?? "null") as { paarungen: { spiel_id: string }[] };

    // The body's order, carried through untouched: a fixture fed by another is restorable only after it.
    assert.deepEqual(
      sent.paarungen.map((entry) => entry.spiel_id),
      [SPIEL_ID, OTHER_SPIEL_ID],
    );
  });

  it("clears every cached read the restored fixtures reach, and reads the page again", async () => {
    await undoAdminSpielEditAction(aReplayOf(SPIEL_ID));

    assert.deepEqual(droppedTags(), EXPECTED_TAGS);
    assert.equal(cacheCalls.filter(({ name }) => name === "refresh").length, 1, "the page the press stands on keeps the undone values");
  });

  /* The replay is one transaction, so a refusal wrote nothing: no cached read moved, and the page is
     left as it stands. */
  it("clears nothing and reads nothing again where the replay is refused", async () => {
    answerWith(() => Promise.reject(refusedOn(REPLAY_OPERATION, "REQ-WIRING-001")));

    await undoAdminSpielEditAction(aReplayOf(SPIEL_ID));

    assert.deepEqual(cacheCalls, []);
  });

  it("refuses a body naming no fixture, which no save produced", async () => {
    const answered = await undoAdminSpielEditAction({ saison_id: SAISON_ID, paarungen: [] });

    assert.equal(answered.success, false);
    // Nothing sent: an empty replay reported as a restore would tell the admin their change was taken
    // back while every row of it still stood.
    assert.equal(calls.length, 0);
  });

  it("reports a mapped refusal as the change still standing", async () => {
    answerWith(() => Promise.reject(refusedOn(REPLAY_OPERATION, "REQ-WIRING-001")));

    const answered = await undoAdminSpielEditAction(aReplayOf(SPIEL_ID, OTHER_SPIEL_ID));

    assert.equal(answered.success, false);
    assert.match(wordsOf(answered), /Herkunft passt nicht mehr/);
    // The whole of the outcome, and true of every entry: the backend committed none of them.
    assert.match(wordsOf(answered), /Die Änderung steht weiterhin\.$/);
  });

  // A row retired before the save being undone meets this refusal too, so a sentence dating the
  // retirement after that save would tell the admin something the record contradicts.
  it("words a retired or deleted booking without saying when it retired", async () => {
    answerWith(() => Promise.reject(refusedOn(REPLAY_OPERATION, "REQ-BOOKING-001")));

    const answered = await undoAdminSpielEditAction(aReplayOf(SPIEL_ID));

    assert.equal(answered.success, false);
    assert.match(wordsOf(answered), /stillgelegt oder gelöscht/);
    assert.doesNotMatch(wordsOf(answered), /inzwischen/);
  });

  it("does not resolve a rejection it cannot word as a success", async () => {
    for (const rejection of [
      unpublishedOn(REPLAY_OPERATION, "REQ-INVENTED-001", 409),
      refusedOn(REPLAY_OPERATION, "REQ-WIRING-001", 500),
      new Error("socket"),
    ]) {
      answerWith(() => Promise.reject(rejection));

      const answered = await undoAdminSpielEditAction(aReplayOf(SPIEL_ID));

      assert.equal(answered.success, false, `${String(rejection)} resolved as a restore`);
      // Never the replay's own refusal text: an unmapped code is a failure the action cannot describe,
      // and wording it as one would tell the admin a rule refused what a crash lost.
      assert.doesNotMatch(wordsOf(answered), /Herkunft/);
    }
  });

  /* It may still have landed, so it is titled unclear and never says the change stands. */
  it("answers an unacknowledged write as of unknown outcome, sending the admin to the fixtures", async () => {
    answerWith(() => Promise.resolve({ ...RESTORED, acknowledged: 0 }));

    assert.deepEqual(
      await undoAdminSpielEditAction(aReplayOf(SPIEL_ID)),
      unacknowledged("Die Rücknahme wurde abgebrochen. Prüfe die betroffenen Spiele."),
    );
  });

  it("answers a clean replay with the plain restored sentence and no warning", async () => {
    const answered = await undoAdminSpielEditAction(aReplayOf(SPIEL_ID));

    assert.deepEqual(answered, { success: true, message: "Die Änderung wurde zurückgenommen.", warn: false });
  });

  it("names what the replay destroyed and raises it as a warning", async () => {
    answerWith(() =>
      Promise.resolve({
        ...RESTORED,
        advanced_to: [
          {
            spiel_id: OTHER_SPIEL_ID,
            spiel_nr: 23,
            voided_ergebnis: "2:0",
            voided_elfmeterschiessen: null,
            voided_sonderereignis: null,
          },
        ],
      }),
    );

    const answered = await undoAdminSpielEditAction(aReplayOf(SPIEL_ID));

    assert.equal(answered.success, true);
    assert.equal(answered.success && answered.warn, true);
    // The restored sentence first, then what it cost: the undo landed, and the loss is the second fact.
    assert.match(wordsOf(answered), /^Die Änderung wurde zurückgenommen\. /);
    assert.match(wordsOf(answered), /Ergebnis in Spiel 23 wurde dabei gelöscht/);
  });

  /* The guard's own words, which an action turned away for the same reason is told, and that the change stands. */
  it("answers a caller with no admin session in the guard's words and writes nothing", async () => {
    setSession(null, "/signin");

    const answered = await undoAdminSpielEditAction(aReplayOf(SPIEL_ID));

    assert.deepEqual(answered, {
      success: false,
      error: "Deine Sitzung hat keine Administratorrechte. Melde Dich neu an. Die Änderung steht weiterhin.",
    });
    assert.equal(calls.length, 0);
  });
});
