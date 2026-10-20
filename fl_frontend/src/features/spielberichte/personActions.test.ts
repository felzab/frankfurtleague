import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { registerDoubles } from "@/core/exportingModule.ts";
import { person } from "@/core/subjectFixtures.ts";
import { doubleActionRequest } from "@/shared/testing/actionDoubles.ts";
import { doubleApiAnswers, requestsOf } from "@/shared/testing/apiClientDouble.ts";
import { assertEachAnswered } from "@/shared/testing/publishedRefusals.ts";
import { BERICHT_SPIEL_ID, spielberichtReadFixture } from "@/shared/testing/spielberichtFixtures.ts";

/** The reports' switch as the doubled config answers it, which a case sets: off where it sets nothing, as production. */
let eingabe = "off";

// A getter, so a case can move the switch the one loaded module reads.
registerDoubles({
  modules: {
    "core/config.ts": {
      frontend_config: {
        get SPIELBERICHT_EINGABE() {
          return eingabe;
        },
      },
    },
  },
});

const SCHIEDSRICHTER_ID = "68c1f0a2b3c4d5e6f7a8b9d1";
const SPIEL_ID = BERICHT_SPIEL_ID;
doubleActionRequest({ session: null, subject: person({ schiedsrichter: [{ schiedsrichter_id: SCHIEDSRICHTER_ID }] }) });
const { answerWith, calls } = doubleApiAnswers();

const { putSpielberichtAction } = await import("./personActions.ts");
const { SPIELBERICHT_GESCHLOSSEN_REFUSAL } = await import("./constants.ts");
const { mapSpielberichtRefusal } = await import("./utils.ts");

const BERICHT = {
  bericht: {
    ergebnis_vorschlag: { team1_tore: 1, team2_tore: 0, elfmeterschiessen: null, sonderereignis: null },
    torschuetzen: [{ seite: "team2" as const, spieler_id: null, minute: "45+2", eigentor: true }],
    karten: [],
    bemerkungen: null,
  },
};

beforeEach(() => {
  eingabe = "off";
  calls.length = 0;
});

describe("the referee's report write", () => {
  /* The closed form's one guarantee: while the switch reads off, no report reaches the backend from this lane. */
  it("answers the closed refusal and sends nothing while the switch reads off", async () => {
    answerWith(() => Promise.resolve({}));

    assert.deepEqual(await putSpielberichtAction(SPIEL_ID, BERICHT), { success: false, error: SPIELBERICHT_GESCHLOSSEN_REFUSAL });
    assert.deepEqual(calls, [], "a report reached the backend with the switch off");
  });

  /* The control the case above needs: an action hard-wired closed passes it too. */
  it("sends the whole block to the fixture named in the path once the switch reads on", async () => {
    eingabe = "on";
    answerWith(() => Promise.resolve(spielberichtReadFixture()));

    const answer = await putSpielberichtAction(SPIEL_ID, BERICHT);

    assert.equal(answer.success, true);
    assert.deepEqual(requestsOf(calls), [{ endpoint: `/spielberichte/${SPIEL_ID}/bericht`, method: "PUT", body: BERICHT }]);
  });

  it("answers every published refusal of the write in the referee's words", async () => {
    eingabe = "on";
    await assertEachAnswered({
      operation: "PUT /spielberichte/{spiel_id}/bericht",
      refuseWith: answerWith,
      act: () => putSpielberichtAction(SPIEL_ID, BERICHT),
      mapped: (refusal) => mapSpielberichtRefusal(refusal, "schiedsrichter"),
    });
  });
});
