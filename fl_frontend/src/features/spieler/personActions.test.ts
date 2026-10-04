import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { person, sitz, SITZ } from "@/core/subjectFixtures.ts";
import { cacheCalls, doubleActionRequest } from "@/shared/testing/actionDoubles.ts";
import { doubleApiAnswers, requestsOf } from "@/shared/testing/apiClientDouble.ts";
import { assertEachAnswered, refusedOn } from "@/shared/testing/publishedRefusals.ts";

import { mapKaderZeileRefusal } from "./refusals.ts";

/* The real actions, their spine and their mutations, called: the request they run in, the subject
   lookup holding one seat, and the backend client are the doubles. */
const { setSubject } = doubleActionRequest({ session: null, subject: person({ sitze: [sitz()] }) });
const { answerWith, calls } = doubleApiAnswers();

const { deleteKaderZeileAction, patchKaderZeileAction } = await import("./personActions.ts");
const { SITZ_WEG } = await import("@/shared/utils/actionError.ts");

const PATCH_OPERATION = "PATCH /spieler/kader/{team_id}/{saison_id}/{spieler_id}";
const DELETE_OPERATION = "DELETE /spieler/kader/{team_id}/{saison_id}/{spieler_id}";

/** The row on team A this season, the address the subject's seat stands at. */
const KEY = { team_id: SITZ.team_id, saison_id: SITZ.saison_id, spieler_id: "68c1f0a2b3c4d5e6f7a8b9c0" };
const FIELDS = { nummer: "07", position: "Tor" as const, stufe: "Q1" as const, rolle: "kapitaen" as const };

/** The row as the backend answers a write that landed. */
const LANDED = {
  acknowledged: 1,
  spieler_id: KEY.spieler_id,
  vorname: "Lena",
  nachname: "Meier",
  ...FIELDS,
  ist_nachnominiert: false,
  inactive_since: null,
  nummer_doppelt: false,
};

/** Every invalidation the write made, by the export it called and what it handed it. */
const invalidations = () => cacheCalls.map(({ name, args }) => [name, ...args]);

describe("a seat holder's squad writes", () => {
  it("reach each published path and method, the ids in the path and the fields alone in the body", async () => {
    answerWith(() => Promise.resolve(LANDED));

    await patchKaderZeileAction({ ...KEY, ...FIELDS });
    await deleteKaderZeileAction(KEY);

    const path = `/spieler/kader/${KEY.team_id}/${KEY.saison_id}/${KEY.spieler_id}`;
    assert.deepEqual(requestsOf(calls), [
      { endpoint: path, method: "PATCH", body: FIELDS },
      { endpoint: path, method: "DELETE", body: undefined },
    ]);
  });

  /* The public squad read is cached for days: a write that drops no tag leaves the old number or the
     removed pupil published until it expires. */
  for (const [name, write] of [
    ["the edit", () => patchKaderZeileAction({ ...KEY, ...FIELDS })],
    ["the austragen", () => deleteKaderZeileAction(KEY)],
  ] as const) {
    it(`drops the squad's cached public read after ${name} lands, and refreshes the page`, async () => {
      answerWith(() => Promise.resolve(LANDED));

      const answer = await write();

      assert.equal(answer.success, true, JSON.stringify(answer));
      assert.deepEqual(invalidations(), [["updateTag", "spieler"], ["refresh"]]);
    });
  }

  /* The seat is the spine's to derive from the session, never the payload's word: the payload names a
     team the person holds nothing on. */
  it("never reaches the backend for a seat the person does not hold", async () => {
    setSubject(person({ sitze: [sitz({ team_id: "6890a1b2c3d4e5f607250012" })] }));
    answerWith(() => Promise.resolve(LANDED));

    const answers = [await patchKaderZeileAction({ ...KEY, ...FIELDS }), await deleteKaderZeileAction(KEY)];

    assert.deepEqual(calls, [], "a write for a seat the person does not hold reached the backend");
    assert.deepEqual(answers, [
      { success: false, error: SITZ_WEG },
      { success: false, error: SITZ_WEG },
    ]);
    assert.deepEqual(invalidations(), [], "a refused write dropped a cache or refreshed the page");
  });
});

describe("what each squad write answers a refusal with", () => {
  /* The captaincy and the season's levels are the slice's own words; a lost seat, a ban and the
     unique index are the shared reader's, which a seat holder meets alike on every person route. */
  it("answers the edit's refusals with the seat holder's squad mapper", async () => {
    await assertEachAnswered({
      operation: PATCH_OPERATION,
      refuseWith: answerWith,
      act: () => patchKaderZeileAction({ ...KEY, ...FIELDS }),
      mapped: mapKaderZeileRefusal,
    });
  });

  it("leaves the austragen's refusals to the shared reader", async () => {
    await assertEachAnswered({
      operation: DELETE_OPERATION,
      refuseWith: answerWith,
      act: () => deleteKaderZeileAction(KEY),
      mapped: () => null,
    });
  });
});

const { patchSpielerEinwilligungAction } = await import("./personActions.ts");
const { EINTRAG_WEG, WAHL_GESPEICHERT } = await import("@/features/konto/einwilligung.ts");

const EINWILLIGUNG_OPERATION = "PATCH /spieler/selbst/einwilligung";
const WAHL = {
  umfang: "intern" as const,
  medien: false,
  text_version: "2026-10-konto-spieler",
  nachweis_stand: { umfang: null, medien: null },
};

/** The record as the backend answers a consent write that landed. */
const EINWILLIGUNG_LANDED = {
  acknowledged: 1,
  spieler_id: KEY.spieler_id,
  einwilligung: {
    umfang: "intern",
    erteilt_von: "volljaehrig",
    datum: "2026-09-01",
    bestaetigt_am: "2026-09-01",
    text_version: "2026-09-spielerseite-3",
    medien: false,
    nachweis: { umfang: null, medien: null },
  },
  // Moved by the press, so an answer echoing the sent stand would not pass for this one.
  nachweis_stand: { umfang: "2026-10-04T09:30:00+02:00", medien: null },
};

describe("a pupil's own consent write", () => {
  /* The consent is an input of the public squad read, cached for days: the call is the only witness
     the tag is dropped, a stale answer and a fresh one being the same answer at runtime. */
  it("sends both choices and the account page's label, drops the squad's cached public read and refreshes the page", async () => {
    setSubject(person({ spieler: [{ spieler_id: KEY.spieler_id }] }));
    answerWith(() => Promise.resolve(EINWILLIGUNG_LANDED));
    calls.length = 0;

    const answer = await patchSpielerEinwilligungAction(WAHL);

    assert.deepEqual(answer, { success: true, message: WAHL_GESPEICHERT, nachweis_stand: EINWILLIGUNG_LANDED.nachweis_stand });
    assert.deepEqual(requestsOf(calls), [{ endpoint: "/spieler/selbst/einwilligung", method: "PATCH", body: WAHL }]);
    assert.deepEqual(invalidations(), [["updateTag", "spieler"], ["refresh"]]);
  });

  /* A retired pupil holds no Funktion and may still withdraw: the record is the backend's to judge. */
  it("reaches the backend for a person holding no player Funktion", async () => {
    setSubject(person());
    answerWith(() => Promise.resolve(EINWILLIGUNG_LANDED));
    calls.length = 0;

    await patchSpielerEinwilligungAction(WAHL);

    assert.equal(requestsOf(calls).length, 1, "a withdrawal from a record granting no panel never reached the backend");
  });

  it("answers the backend's lost record in words naming no team, and drops nothing", async () => {
    setSubject(person({ spieler: [{ spieler_id: KEY.spieler_id }] }));
    answerWith(() => Promise.reject(refusedOn(EINWILLIGUNG_OPERATION, "REQ-FUNKTION-001", 403)));

    const answer = await patchSpielerEinwilligungAction(WAHL);

    assert.deepEqual(answer, { success: false, error: EINTRAG_WEG, fieldErrors: undefined });
    assert.deepEqual(invalidations(), [], "a refused write dropped a cache or refreshed the page");
  });
});
