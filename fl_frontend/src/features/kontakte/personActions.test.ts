import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { person, sitz, SITZ } from "@/core/subjectFixtures.ts";
import { cacheCalls, doubleActionRequest } from "@/shared/testing/actionDoubles.ts";
import { doubleApiAnswers, requestsOf } from "@/shared/testing/apiClientDouble.ts";
import { refusedOn } from "@/shared/testing/publishedRefusals.ts";

/* The real action, its spine and its mutation, called: the request it runs in, the subject lookup and
   the backend client are the doubles. */
const { setSubject } = doubleActionRequest({ session: null, subject: person({ sitze: [sitz()] }) });
const { answerWith, calls } = doubleApiAnswers();

const { patchSitzEinwilligungAction } = await import("./personActions.ts");
const { EINTRAG_WEG, MEDIEN_ZU_JUNG, SEITE_VERALTET, WAHL_GESPEICHERT } = await import("@/features/konto/einwilligung.ts");

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
