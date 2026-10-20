import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { person } from "@/core/subjectFixtures.ts";
import { cacheCalls, doubleActionRequest } from "@/shared/testing/actionDoubles.ts";
import { doubleApiAnswers, requestsOf } from "@/shared/testing/apiClientDouble.ts";
import { assertEachAnswered, refusedOn } from "@/shared/testing/publishedRefusals.ts";

/* The real actions, their spine and their mutation, called: the request they run in, the subject lookup and
   the backend client are the doubles. */
const SCHIEDSRICHTER_ID = "68c1f0a2b3c4d5e6f7a8b9d1";
const SPIELBESTAETIGUNG_ID = "68c1f0a2b3c4d5e6f7a8b9e1";
doubleActionRequest({ session: null, subject: person({ schiedsrichter: [{ schiedsrichter_id: SCHIEDSRICHTER_ID }] }) });
const { answerWith, calls } = doubleApiAnswers();

const { absagenSpielbestaetigungAction, zusagenSpielbestaetigungAction } = await import("./personActions.ts");
const { ABSAGE_GESPEICHERT, mapSchiedsrichterAntwortRefusal, ZUSAGE_GESPEICHERT } = await import("./utils.ts");
const { SITZ_WEG } = await import("@/shared/utils/actionError.ts");

const OPERATION = "POST /spielbestaetigungen/{spielbestaetigung_id}/antwort";
const ENDPOINT = `/spielbestaetigungen/${SPIELBESTAETIGUNG_ID}/antwort`;

/** Every invalidation the write made, by the export it called and what it handed it. */
const invalidations = () => cacheCalls.map(({ name, args }) => [name, ...args]);

describe("a referee's answer to a row of their own", () => {
  /* The fixtures read is cached for hours and serves the referee only once they agreed: an acceptance that left the
     tag standing would keep the referee off the schedule they just agreed to, a decline keep them on it. */
  it("sends an acceptance with no reason, drops the fixtures' cached read and refreshes the page", async () => {
    answerWith(() => Promise.resolve({ acknowledged: 1, spielbestaetigung_id: SPIELBESTAETIGUNG_ID, zustand: "zugesagt" }));
    calls.length = 0;

    const answer = await zusagenSpielbestaetigungAction(SPIELBESTAETIGUNG_ID);

    assert.deepEqual(answer, { success: true, message: ZUSAGE_GESPEICHERT, zustand: "zugesagt" });
    assert.deepEqual(requestsOf(calls), [{ endpoint: ENDPOINT, method: "POST", body: { antwort: "zugesagt", begruendung: null } }]);
    assert.deepEqual(invalidations(), [["updateTag", "spiele"], ["refresh"]]);
  });

  it("sends a decline with its reason, drops the fixtures' cached read and refreshes the page", async () => {
    answerWith(() => Promise.resolve({ acknowledged: 1, spielbestaetigung_id: SPIELBESTAETIGUNG_ID, zustand: "abgelehnt" }));
    calls.length = 0;

    const answer = await absagenSpielbestaetigungAction(SPIELBESTAETIGUNG_ID, { begruendung: "Klassenfahrt" });

    assert.deepEqual(answer, { success: true, message: ABSAGE_GESPEICHERT, zustand: "abgelehnt" });
    assert.deepEqual(requestsOf(calls), [{ endpoint: ENDPOINT, method: "POST", body: { antwort: "abgelehnt", begruendung: "Klassenfahrt" } }]);
    assert.deepEqual(invalidations(), [["updateTag", "spiele"], ["refresh"]]);
  });

  it("refuses a decline without its reason, and a malformed id, before the backend", async () => {
    calls.length = 0;

    const ohneGrund = await absagenSpielbestaetigungAction(SPIELBESTAETIGUNG_ID, { begruendung: "  " });
    assert.equal(ohneGrund.success, false);
    assert.ok(!ohneGrund.success && ohneGrund.fieldErrors?.begruendung !== undefined, "an empty reason is refused on no box");
    assert.equal((await zusagenSpielbestaetigungAction("kein-id")).success, false);
    assert.deepEqual(calls, [], "a refused press reached the backend");
  });

  /* The shared reader's sentence names a team, which a referee holds none of. */
  it("answers a lost referee record in the referee's words, never the team's", async () => {
    answerWith(() => Promise.reject(refusedOn(OPERATION, "REQ-FUNKTION-001", 403)));

    const answer = await zusagenSpielbestaetigungAction(SPIELBESTAETIGUNG_ID);

    assert.ok(
      !answer.success && answer.error !== SITZ_WEG && answer.error?.includes("Schiedsrichterin oder Schiedsrichter"),
      JSON.stringify(answer),
    );
    assert.deepEqual(invalidations(), [], "a refused write dropped a cache or refreshed the page");
  });

  /* Every code the document publishes, through the referee's mapper: an action consulting it for a few would answer
     the rest in the shared fallback's words, which name no reason. */
  it("answers every published refusal through the referee's mapper", async () => {
    await assertEachAnswered({
      operation: OPERATION,
      refuseWith: answerWith,
      act: () => absagenSpielbestaetigungAction(SPIELBESTAETIGUNG_ID, { begruendung: "Klassenfahrt" }),
      mapped: mapSchiedsrichterAntwortRefusal,
    });
  });
});
