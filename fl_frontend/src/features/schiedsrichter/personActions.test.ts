import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { person } from "@/core/subjectFixtures.ts";
import { cacheCalls, doubleActionRequest } from "@/shared/testing/actionDoubles.ts";
import { doubleApiAnswers, requestsOf } from "@/shared/testing/apiClientDouble.ts";
import { assertEachAnswered, refusedOn } from "@/shared/testing/publishedRefusals.ts";

/* The real action, its spine and its mutation, called: the request it runs in, the subject lookup and
   the backend client are the doubles. */
const SCHIEDSRICHTER_ID = "68c1f0a2b3c4d5e6f7a8b9d1";
const { setSubject } = doubleActionRequest({ session: null, subject: person({ schiedsrichter: [{ schiedsrichter_id: SCHIEDSRICHTER_ID }] }) });
const { answerWith, calls } = doubleApiAnswers();

const { patchSchiedsrichterEinwilligungAction } = await import("./personActions.ts");
const { EINTRAG_WEG, mapEigeneEinwilligungRefusal, MEDIEN_ZU_JUNG, WAHL_GESPEICHERT, ZUSTIMMEN_MORGEN } =
  await import("@/features/konto/einwilligung.ts");

const OPERATION = "PATCH /schiedsrichter/selbst/{schiedsrichter_id}/einwilligung";
const WAHL = {
  umfang: "kader_oeffentlich" as const,
  medien: true,
  text_version: "2026-10-konto-schiedsrichter",
  nachweis_stand: { umfang: null, medien: null },
};

const LANDED = {
  acknowledged: 1,
  schiedsrichter_id: SCHIEDSRICHTER_ID,
  einwilligung: {
    umfang: "kader_oeffentlich",
    erteilt_von: "volljaehrig",
    datum: "2026-09-01",
    bestaetigt_am: "2026-09-01",
    text_version: "2026-09-schiedsrichterseite-3",
    medien: true,
    nachweis: { umfang: null, medien: null },
  },
  // Moved by the press, so an answer echoing the sent stand would not pass for this one.
  nachweis_stand: { umfang: null, medien: "2026-10-04T09:30:00+02:00" },
};

/** Every invalidation the write made, by the export it called and what it handed it. */
const invalidations = () => cacheCalls.map(({ name, args }) => [name, ...args]);

describe("a referee's own consent write", () => {
  /* The fixtures read carries the referee's name to every visitor and is cached for hours; the write
     touches no match, so the call is the only witness the tag is dropped. */
  it("sends both choices to the record named in the path, drops the fixtures' cached read and refreshes the page", async () => {
    answerWith(() => Promise.resolve(LANDED));
    calls.length = 0;

    const answer = await patchSchiedsrichterEinwilligungAction(SCHIEDSRICHTER_ID, WAHL);

    assert.deepEqual(answer, { success: true, message: WAHL_GESPEICHERT, nachweis_stand: LANDED.nachweis_stand });
    assert.deepEqual(requestsOf(calls), [
      { endpoint: `/schiedsrichter/selbst/${SCHIEDSRICHTER_ID}/einwilligung`, method: "PATCH", body: WAHL },
    ]);
    assert.deepEqual(invalidations(), [["updateTag", "spiele"], ["refresh"]]);
  });

  /* A retired referee holds no Funktion and may still withdraw: the record is the backend's to judge. */
  it("reaches the backend for a person holding no referee Funktion", async () => {
    setSubject(person());
    answerWith(() => Promise.resolve(LANDED));
    calls.length = 0;

    await patchSchiedsrichterEinwilligungAction(SCHIEDSRICHTER_ID, { ...WAHL, umfang: "intern", medien: false });

    assert.equal(requestsOf(calls).length, 1, "a withdrawal from a record granting no panel never reached the backend");
  });

  it("refuses an id that names no record before the backend", async () => {
    calls.length = 0;

    const answer = await patchSchiedsrichterEinwilligungAction("kein-id", WAHL);

    assert.equal(answer.success, false);
    assert.deepEqual(calls, [], "a malformed id reached the backend");
  });

  for (const [code, status, words] of [
    ["REQ-FUNKTION-001", 403, EINTRAG_WEG],
    ["REQ-EINWILLIGUNG-002", 422, MEDIEN_ZU_JUNG],
  ] as const) {
    it(`answers ${code} in the account page's words and drops nothing`, async () => {
      setSubject(person({ schiedsrichter: [{ schiedsrichter_id: SCHIEDSRICHTER_ID }] }));
      answerWith(() => Promise.reject(refusedOn(OPERATION, code, status)));

      const answer = await patchSchiedsrichterEinwilligungAction(SCHIEDSRICHTER_ID, WAHL);

      assert.deepEqual(answer, { success: false, error: words, fieldErrors: undefined });
      assert.deepEqual(invalidations(), [], "a refused write dropped a cache or refreshed the page");
    });
  }
});

/* Every code the document publishes, through the consent writes' one mapper: an action consulting it
   for the lost record alone would answer the rest in the shared fallback's words. */
describe("what a referee's own consent write answers a refusal with", () => {
  it("answers every published refusal of the referee's write through the consent mapper", async () => {
    setSubject(person({ schiedsrichter: [{ schiedsrichter_id: SCHIEDSRICHTER_ID }] }));
    await assertEachAnswered({
      operation: OPERATION,
      refuseWith: answerWith,
      act: () => patchSchiedsrichterEinwilligungAction(SCHIEDSRICHTER_ID, WAHL),
      mapped: mapEigeneEinwilligungRefusal,
    });
  });

  /* A grant past the day's ceiling is told that withdrawing still goes through, where the spine's own
     sentence would not say so (`docs/frontend/spec.md :: I836`). */
  it("answers a referee's grant past the day's ceiling with the withdrawal still open", async () => {
    setSubject(person({ schiedsrichter: [{ schiedsrichter_id: SCHIEDSRICHTER_ID }] }));
    answerWith(() => Promise.reject(refusedOn(OPERATION, "REQ-DROSSELUNG-001")));

    assert.deepEqual(await (() => patchSchiedsrichterEinwilligungAction(SCHIEDSRICHTER_ID, WAHL))(), {
      success: false,
      error: ZUSTIMMEN_MORGEN,
      fieldErrors: undefined,
    });
  });
});
