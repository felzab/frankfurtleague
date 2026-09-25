import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { doubleApiAnswers, requestsOf } from "@/shared/testing/apiClientDouble.ts";
import { publishedRefusals, refusedOn } from "@/shared/testing/publishedRefusals.ts";
import { assertEachRefusalCloses, doubleRouteRequest, unacknowledged, undo } from "@/shared/testing/undoRoutes.ts";

import type { ApiCall } from "@/shared/testing/apiClientDouble.ts";

/* The real route and the mutations it replays through, called: the request it runs in and the backend client are the doubles. */
doubleRouteRequest();
const { answerWith, calls } = doubleApiAnswers();
const { POST } = await import("./route.ts");

/**
 * What `fl_frontend/src/features/spieler/mutations.ts :: patchSaisonSpieler` sends, as the backend's own routes spell
 * it. The person half's `PATCH /spieler/{spieler_id}` publishes no 409.
 */
const SQUAD_OPERATION = "PATCH /spieler/{spieler_id}/saisons/{saison_id}";

const SPIELER_ID = "68c1f0a2b3c4d5e6f7a8b9c0";
const PERSON = { id: SPIELER_ID, vorname: "Lena", nachname: "Meier", geburtsdatum: null };
const SAISON = {
  spieler_id: SPIELER_ID,
  saison_id: "2026",
  team_id: "6890a1b2c3d4e5f607182932",
  nummer: null,
  position: null,
  stufe: null,
  rolle: null,
};

const PERSON_PATH = `/spieler/${SPIELER_ID}`;
const SQUAD_PATH = `/spieler/${SPIELER_ID}/saisons/${SAISON.saison_id}`;

/** Whether `call` is the squad half's request. */
const isTheSquadHalf = (call: ApiCall): boolean => call.endpoint === SQUAD_PATH;

/** The person half restored, and the squad half refused with `code`. */
function refuseTheSquadHalf(code: string): void {
  answerWith((call) => (isTheSquadHalf(call) ? Promise.reject(refusedOn(SQUAD_OPERATION, code)) : Promise.resolve({ acknowledged: 1 })));
}

describe("the player save's undo", () => {
  it("replays both halves, the person first", async () => {
    const answer = await undo(POST, { person: PERSON, saison: SAISON });

    assert.equal(answer.success, true, String(answer.error));
    const { id, ...person } = PERSON;
    const { spieler_id, saison_id, ...squad } = SAISON;
    assert.deepEqual(requestsOf(calls), [
      { endpoint: `/spieler/${id}`, method: "PATCH", body: person },
      { endpoint: `/spieler/${spieler_id}/saisons/${saison_id}`, method: "PATCH", body: squad },
    ]);
  });

  it("words every refusal the squad half publishes, closing on the change standing once", async () => {
    await assertEachRefusalCloses({
      codes: publishedRefusals(SQUAD_OPERATION),
      refuse: refuseTheSquadHalf,
      press: () => undo(POST, { saison: SAISON }),
    });
  });

  /* The person half went back first, so the change does not stand whole and the answer may not say it does. */
  it("says only the person half went back where the squad half is refused after it", async () => {
    await assertEachRefusalCloses({
      codes: publishedRefusals(SQUAD_OPERATION),
      refuse: refuseTheSquadHalf,
      press: () => undo(POST, { person: PERSON, saison: SAISON }),
      closing: "Nur die Personendaten wurden zurückgesetzt.",
    });
  });

  /* Unacknowledged, a write may still have landed, so each arm is titled unclear and never says the
     change stands; the second half's sentence says whether the first went back. */
  it("answers an unacknowledged person half as of unknown outcome, replaying nothing after it", async () => {
    answerWith(() => Promise.resolve({ acknowledged: 0 }));

    assert.deepEqual(
      await undo(POST, { person: PERSON, saison: SAISON }),
      unacknowledged("Die Rücknahme wurde abgebrochen. Prüfe die Spielerdaten."),
    );
    assert.deepEqual(
      calls.map(({ endpoint }) => endpoint),
      [PERSON_PATH],
    );
  });

  it("answers an unacknowledged squad half as of unknown outcome, alone or after the person half", async () => {
    answerWith((call) => Promise.resolve({ acknowledged: isTheSquadHalf(call) ? 0 : 1 }));

    assert.deepEqual(await undo(POST, { saison: SAISON }), unacknowledged("Die Rücknahme wurde abgebrochen. Prüfe den Kadereintrag."));
    assert.deepEqual(
      await undo(POST, { person: PERSON, saison: SAISON }),
      unacknowledged("Nur die Personendaten wurden zurückgesetzt. Prüfe den Kadereintrag."),
    );
  });
});
