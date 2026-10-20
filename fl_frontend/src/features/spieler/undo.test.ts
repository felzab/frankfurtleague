import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { doubleActionRequest } from "@/shared/testing/actionDoubles.ts";
import { doubleApiAnswers, requestsOf } from "@/shared/testing/apiClientDouble.ts";
import { publishedRefusals, refusedOn, unpublishedOn } from "@/shared/testing/publishedRefusals.ts";
import { assertEachRefusalCloses, droppedTags, failedWrite, refreshes, unacknowledged } from "@/shared/testing/undoActions.ts";

import type { ApiCall } from "@/shared/testing/apiClientDouble.ts";

/* The real action and the mutations it replays through, called: the request it runs in and the backend client are the doubles. */
doubleActionRequest();
const { answerWith, calls } = doubleApiAnswers((call) => Promise.resolve(replayed(call, 1)));
const { undoAdminSpielerEditAction } = await import("./actions.ts");

/**
 * What `fl_frontend/src/features/spieler/mutations.ts :: patchSaisonSpieler` sends, as the backend's own routes spell
 * it. The person half's `PATCH /spieler/{spieler_id}` publishes no 409.
 */
const SQUAD_OPERATION = "PATCH /spieler/{spieler_id}/saisons/{saison_id}";

const SPIELER_ID = "68c1f0a2b3c4d5e6f7a8b9c0";
const PERSON = { id: SPIELER_ID, vorname: "Lena", nachname: "Meier", geburtsdatum: "2009-05-04" };
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

/** Either half's answer as the backend sends it, the row restored. */
const replayed = (call: ApiCall, acknowledged: 0 | 1) =>
  isTheSquadHalf(call)
    ? { acknowledged, ...SAISON, ist_nachnominiert: false, inactive_since: null }
    : { acknowledged, spieler_id: SPIELER_ID, vorname: PERSON.vorname, nachname: PERSON.nachname, inactive_since: null };

/** The person half restored, and the squad half refused with `code`. */
function refuseTheSquadHalf(code: string): void {
  answerWith((call) => (isTheSquadHalf(call) ? Promise.reject(refusedOn(SQUAD_OPERATION, code)) : Promise.resolve(replayed(call, 1))));
}

describe("the player save's undo", () => {
  it("replays both halves, the person first", async () => {
    const answer = await undoAdminSpielerEditAction({ person: PERSON, saison: SAISON });

    assert.equal(answer.success, true, JSON.stringify(answer));
    const { id, ...person } = PERSON;
    const { spieler_id, saison_id, ...squad } = SAISON;
    assert.deepEqual(requestsOf(calls), [
      { endpoint: `/spieler/${id}`, method: "PATCH", body: person },
      { endpoint: `/spieler/${spieler_id}/saisons/${saison_id}`, method: "PATCH", body: squad },
    ]);
    // The caches the replay moves, which the spine drops at once.
    assert.deepEqual(droppedTags(), ["spieler"]);
  });

  it("words every refusal the squad half publishes, closing on the change standing once", async () => {
    await assertEachRefusalCloses({
      codes: publishedRefusals(SQUAD_OPERATION),
      refuse: refuseTheSquadHalf,
      press: () => undoAdminSpielerEditAction({ saison: SAISON }),
    });
  });

  /* The person half went back first, so the change does not stand whole and the answer may not say it does. */
  it("says only the person half went back where the squad half is refused after it", async () => {
    await assertEachRefusalCloses({
      codes: publishedRefusals(SQUAD_OPERATION),
      refuse: refuseTheSquadHalf,
      press: () => undoAdminSpielerEditAction({ person: PERSON, saison: SAISON }),
      closing: "Nur die Personendaten wurden zurückgesetzt.",
    });
  });

  /* Unacknowledged, a write may still have landed, so each arm is titled unclear and never says the
     change stands; the second half's sentence says whether the first went back. */
  it("answers an unacknowledged person half as of unknown outcome, replaying nothing after it", async () => {
    answerWith((call) => Promise.resolve(replayed(call, 0)));

    assert.deepEqual(
      await undoAdminSpielerEditAction({ person: PERSON, saison: SAISON }),
      unacknowledged("Die Rücknahme wurde abgebrochen. Prüfe die Spielerdaten."),
    );
    assert.deepEqual(
      calls.map(({ endpoint }) => endpoint),
      [PERSON_PATH],
    );
  });

  it("answers an unacknowledged squad half as of unknown outcome, alone or after the person half", async () => {
    answerWith((call) => Promise.resolve(replayed(call, isTheSquadHalf(call) ? 0 : 1)));

    assert.deepEqual(
      await undoAdminSpielerEditAction({ saison: SAISON }),
      unacknowledged("Die Rücknahme wurde abgebrochen. Prüfe den Kadereintrag."),
    );
    assert.deepEqual(
      await undoAdminSpielerEditAction({ person: PERSON, saison: SAISON }),
      unacknowledged("Nur die Personendaten wurden zurückgesetzt. Prüfe den Kadereintrag."),
    );
  });

  /* The person half stands behind a squad row that failed outright, so the cache that half moved is
     dropped and the page read again, as it is behind a refused squad row. */
  it("clears the cache and reads the page again where the squad half fails after the person half went back", async () => {
    answerWith((call) => (isTheSquadHalf(call) ? Promise.reject(failedWrite(call.endpoint)) : Promise.resolve(replayed(call, 1))));

    // The server's reason, then the half that went back, never a retry: the offer pressed is gone.
    assert.deepEqual(await undoAdminSpielerEditAction({ person: PERSON, saison: SAISON }), {
      success: false,
      error: "Der Server hat mit einem Fehler geantwortet. Nur die Personendaten wurden zurückgesetzt.",
      outcome: "partial",
    });
    assert.deepEqual(droppedTags(), ["spieler"]);
    assert.equal(refreshes(), 1, "the page keeps the person data the undo already put back");
  });

  /* A rule no table words has no reason to name, so the answer names the half that cannot go back. */
  it("names the squad entry where a rule no table words refuses it after the person half went back", async () => {
    const refusal = unpublishedOn(SQUAD_OPERATION, "REQ-UNCLAIMED-000", 409);
    answerWith((call) => (isTheSquadHalf(call) ? Promise.reject(refusal) : Promise.resolve(replayed(call, 1))));

    assert.deepEqual(await undoAdminSpielerEditAction({ person: PERSON, saison: SAISON }), {
      success: false,
      error: "Der Kadereintrag lässt sich so nicht mehr zurücksetzen. Nur die Personendaten wurden zurückgesetzt.",
      outcome: "partial",
    });
  });
});
