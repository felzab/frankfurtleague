import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { person, sitz, SITZ } from "@/core/subjectFixtures.ts";
import { cacheCalls, doubleActionRequest } from "@/shared/testing/actionDoubles.ts";
import { doubleApiAnswers, requestsOf } from "@/shared/testing/apiClientDouble.ts";
import { assertEachAnswered, refusedOn } from "@/shared/testing/publishedRefusals.ts";

/* The real action, its spine and its mutation, called: the request it runs in, the subject lookup and
   the backend client are the doubles. */
const { setSubject } = doubleActionRequest({ session: null, subject: person({ sitze: [sitz()] }) });
const { answerWith, calls } = doubleApiAnswers();

const { patchBewerbungEinwilligungAction, patchSitzEinwilligungAction } = await import("./personActions.ts");
const { EINTRAG_WEG, mapEigeneEinwilligungRefusal, MEDIEN_ZU_JUNG, SEITE_VERALTET, WAHL_GESPEICHERT, ZUSTIMMEN_MORGEN } =
  await import("@/features/konto/einwilligung.ts");

const OPERATION = "PATCH /teams/{team_id}/saisons/{saison_id}/person/einwilligung";
const WAHL = { medien: true, text_version: "2026-10-konto-kontakt", nachweis_stand: { medien: null } };
const LANDED = {
  acknowledged: 1,
  team_id: SITZ.team_id,
  saison_id: SITZ.saison_id,
  rollen: ["trainer"],
  medien: true,
  // Moved by the press, so an answer echoing the sent stand would not pass for this one.
  nachweis_stand: { medien: "2026-10-04T09:30:00+02:00" },
};

/** Every invalidation the write made, by the export it called and what it handed it. */
const invalidations = () => cacheCalls.map(({ name, args }) => [name, ...args]);

describe("a seat holder's own media consent write", () => {
  it("sends the media choice and the account page's label to the row's path, and refreshes the page", async () => {
    answerWith(() => Promise.resolve(LANDED));
    calls.length = 0;

    const answer = await patchSitzEinwilligungAction(SITZ.team_id, SITZ.saison_id, WAHL);

    assert.deepEqual(answer, { success: true, message: WAHL_GESPEICHERT, nachweis_stand: LANDED.nachweis_stand });
    assert.deepEqual(requestsOf(calls), [
      { endpoint: `/teams/${SITZ.team_id}/saisons/${SITZ.saison_id}/person/einwilligung`, method: "PATCH", body: WAHL },
    ]);
    // No public read serves a seat's media choice: the spine's refresh is the page's whole re-read.
    assert.deepEqual(invalidations(), [["refresh"]]);
  });

  /* A past season grants no panel, so its seat is no Funktion; the withdrawal it owes is the backend's to judge. */
  it("reaches the backend for a seat holder of a past season alone", async () => {
    setSubject(person({ sitze: [sitz({ saison_status: "past" })] }));
    answerWith(() => Promise.resolve({ ...LANDED, medien: false }));
    calls.length = 0;

    await patchSitzEinwilligungAction(SITZ.team_id, SITZ.saison_id, { ...WAHL, medien: false });

    assert.equal(requestsOf(calls).length, 1, "a withdrawal on a past season's seat never reached the backend");
  });

  it("refuses an address that names no team season before the backend", async () => {
    calls.length = 0;

    const answer = await patchSitzEinwilligungAction("kein-id", SITZ.saison_id, WAHL);

    assert.equal(answer.success, false);
    assert.deepEqual(calls, [], "a malformed address reached the backend");
  });

  for (const [code, status, words] of [
    ["REQ-FUNKTION-001", 403, EINTRAG_WEG],
    ["REQ-EINWILLIGUNG-001", 409, SEITE_VERALTET],
    ["REQ-EINWILLIGUNG-002", 422, MEDIEN_ZU_JUNG],
  ] as const) {
    it(`answers ${code} in the account page's words and refreshes nothing`, async () => {
      setSubject(person({ sitze: [sitz()] }));
      answerWith(() => Promise.reject(refusedOn(OPERATION, code, status)));

      const answer = await patchSitzEinwilligungAction(SITZ.team_id, SITZ.saison_id, WAHL);

      assert.deepEqual(answer, { success: false, error: words, fieldErrors: undefined });
      assert.deepEqual(invalidations(), [], "a refused write refreshed the page");
    });
  }
});

const BEWERBUNG_ID = "6890a1b2c3d4e5f607181001";
const BEWERBUNG_OPERATION = "PATCH /bewerbungen/{bewerbung_id}/person/einwilligung";
const WIDERRUF = { medien: false, text_version: "2026-10-konto-kontakt", nachweis_stand: { medien: "2026-09-01T10:00:00+02:00" } };
const WIDERRUFEN = {
  acknowledged: 1,
  bewerbung_id: BEWERBUNG_ID,
  rollen: ["ansprechperson"],
  medien: false,
  // Moved by the press, so an answer echoing the sent stand would not pass for this one.
  nachweis_stand: { medien: "2026-10-04T09:30:00+02:00" },
};

describe("a seat holder's withdrawal on a pending application", () => {
  /* A pending application grants no Funktion, so a person holding none reaches the backend, which
     judges the seat itself. */
  it("sends the withdrawal and the account page's label to the application's path, and refreshes the page", async () => {
    setSubject(person());
    answerWith(() => Promise.resolve(WIDERRUFEN));
    calls.length = 0;

    const answer = await patchBewerbungEinwilligungAction(BEWERBUNG_ID, WIDERRUF);

    assert.deepEqual(answer, { success: true, message: WAHL_GESPEICHERT, nachweis_stand: WIDERRUFEN.nachweis_stand });
    assert.deepEqual(requestsOf(calls), [{ endpoint: `/bewerbungen/${BEWERBUNG_ID}/person/einwilligung`, method: "PATCH", body: WIDERRUF }]);
    // No public read serves an application: the spine's refresh is the page's whole re-read.
    assert.deepEqual(invalidations(), [["refresh"]]);
  });

  /* The endpoint takes `false` alone, so a grant is refused before the network, in the payload's own words. */
  it("refuses a grant and a malformed application before the backend", async () => {
    setSubject(person());
    calls.length = 0;

    const grant = await patchBewerbungEinwilligungAction(BEWERBUNG_ID, { ...WIDERRUF, medien: true });
    const malformed = await patchBewerbungEinwilligungAction("kein-id", WIDERRUF);

    assert.equal(grant.success, false);
    assert.equal(malformed.success, false);
    assert.deepEqual(calls, [], "a refused press reached the backend");
  });

  for (const [code, status, words] of [
    ["REQ-FUNKTION-001", 403, EINTRAG_WEG],
    ["REQ-EINWILLIGUNG-001", 409, SEITE_VERALTET],
    ["REQ-EINWILLIGUNG-003", 409, SEITE_VERALTET],
  ] as const) {
    it(`answers ${code} in the account page's words and refreshes nothing`, async () => {
      setSubject(person());
      answerWith(() => Promise.reject(refusedOn(BEWERBUNG_OPERATION, code, status)));

      const answer = await patchBewerbungEinwilligungAction(BEWERBUNG_ID, WIDERRUF);

      assert.deepEqual(answer, { success: false, error: words, fieldErrors: undefined });
      assert.deepEqual(invalidations(), [], "a refused write refreshed the page");
    });
  }
});

/* Every code the document publishes, through the consent writes' one mapper: an action consulting it
   for the lost record alone would answer the rest in the shared fallback's words. */
describe("what a seat holder's consent writes answer a refusal with", () => {
  it("answers every published refusal of the season seat's write through the consent mapper", async () => {
    setSubject(person({ sitze: [sitz()] }));
    await assertEachAnswered({
      operation: OPERATION,
      refuseWith: answerWith,
      act: () => patchSitzEinwilligungAction(SITZ.team_id, SITZ.saison_id, WAHL),
      mapped: mapEigeneEinwilligungRefusal,
    });
  });

  it("answers every published refusal of the application seat's withdrawal through the consent mapper", async () => {
    setSubject(person());
    await assertEachAnswered({
      operation: BEWERBUNG_OPERATION,
      refuseWith: answerWith,
      act: () => patchBewerbungEinwilligungAction(BEWERBUNG_ID, WIDERRUF),
      mapped: mapEigeneEinwilligungRefusal,
    });
  });

  /* A grant past the day's ceiling is told that withdrawing still goes through, where the spine's own
     sentence would not say so (`docs/frontend/spec.md :: I836`). */
  it("answers a season seat's grant past the day's ceiling with the withdrawal still open", async () => {
    setSubject(person({ sitze: [sitz()] }));
    answerWith(() => Promise.reject(refusedOn(OPERATION, "REQ-DROSSELUNG-001")));

    assert.deepEqual(await (() => patchSitzEinwilligungAction(SITZ.team_id, SITZ.saison_id, WAHL))(), {
      success: false,
      error: ZUSTIMMEN_MORGEN,
      fieldErrors: undefined,
    });
  });
});
