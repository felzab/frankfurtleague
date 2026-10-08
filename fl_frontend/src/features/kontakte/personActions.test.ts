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
const { mapBewerbungEinwilligungRefusal, mapEigeneEinwilligungRefusal, WAHL_GESPEICHERT, ZUSTIMMEN_MORGEN } =
  await import("@/features/konto/einwilligung.ts");

const OPERATION = "PATCH /teams/{team_id}/saisons/{saison_id}/person/einwilligung";
// Both choices on every press, the scope unchanged beside the media grant.
const WAHL = {
  umfang: "kontaktdaten_whatsapp" as const,
  medien: true,
  text_version: "2026-10-konto-kontakt",
  nachweis_stand: { umfang: "9f2c1e7a4b5d6e8f0a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f6071", medien: null },
};
const LANDED = {
  acknowledged: 1,
  team_id: SITZ.team_id,
  saison_id: SITZ.saison_id,
  rollen: ["trainer"],
  umfang: "kontaktdaten_whatsapp",
  medien: true,
  // Moved by the press, so an answer echoing the sent stand would not pass for this one.
  nachweis_stand: {
    umfang: "9f2c1e7a4b5d6e8f0a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f6071",
    medien: "1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90a",
  },
};

/** Every invalidation the write made, by the export it called and what it handed it. */
const invalidations = () => cacheCalls.map(({ name, args }) => [name, ...args]);

describe("a seat holder's own consent write", () => {
  it("sends both choices and the account page's label to the row's path, and refreshes the page", async () => {
    answerWith(() => Promise.resolve(LANDED));
    calls.length = 0;

    const answer = await patchSitzEinwilligungAction(SITZ.team_id, SITZ.saison_id, WAHL);

    assert.deepEqual(answer, { success: true, message: WAHL_GESPEICHERT, nachweis_stand: LANDED.nachweis_stand });
    assert.deepEqual(requestsOf(calls), [
      { endpoint: `/teams/${SITZ.team_id}/saisons/${SITZ.saison_id}/person/einwilligung`, method: "PATCH", body: WAHL },
    ]);
    // No public read serves a seat's choices: the spine's refresh is the page's whole re-read.
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
});

const BEWERBUNG_ID = "6890a1b2c3d4e5f607181001";
const BEWERBUNG_OPERATION = "PATCH /bewerbungen/{bewerbung_id}/person/einwilligung";
// The WhatsApp scope withdrawn beside a media consent left standing: a withdrawal of one choice alone.
const WIDERRUF = {
  umfang: "kontaktdaten" as const,
  medien: true,
  text_version: "2026-10-konto-kontakt",
  nachweis_stand: {
    umfang: "9f2c1e7a4b5d6e8f0a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f6071",
    medien: "1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90a",
  },
};
const WIDERRUFEN = {
  acknowledged: 1,
  bewerbung_id: BEWERBUNG_ID,
  rollen: ["ansprechperson"],
  umfang: "kontaktdaten",
  medien: true,
  // Moved by the press, so an answer echoing the sent stand would not pass for this one.
  nachweis_stand: {
    umfang: "1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90a",
    medien: "1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90a",
  },
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

  it("refuses a malformed application before the backend", async () => {
    setSubject(person());
    calls.length = 0;

    const malformed = await patchBewerbungEinwilligungAction("kein-id", WIDERRUF);

    assert.equal(malformed.success, false);
    assert.deepEqual(calls, [], "a refused press reached the backend");
  });
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
      mapped: mapBewerbungEinwilligungRefusal,
    });
  });

  /* A grant past the day's ceiling is told that withdrawing still goes through, where the spine's own
     sentence would not say so (`docs/frontend/spec.md :: I655`). */
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
