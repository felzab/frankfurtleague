import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { registerDoubles } from "@/core/exportingModule.ts";
import { cacheCalls, doubleActionRequest } from "@/shared/testing/actionDoubles.ts";
import { doubleApiAnswers, requestsOf } from "@/shared/testing/apiClientDouble.ts";
import { assertEachAnswered, refusedOn } from "@/shared/testing/publishedRefusals.ts";
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

/* The real action, its spine and its mutation, called: the request it runs in and the backend client are the doubles. */
const { setFresh } = doubleActionRequest();
const { answerWith, calls } = doubleApiAnswers();

const { patchAdminSpielberichtAction } = await import("./actions.ts");
const { SPIELBERICHT_GESCHLOSSEN_REFUSAL } = await import("./constants.ts");
const { mapSpielberichtRefusal } = await import("./utils.ts");
const { stepUpRequired } = await import("@/shared/utils/adminMutation.ts");

const BERICHT = {
  bericht: {
    ergebnis_vorschlag: { team1_tore: 0, team2_tore: 0, elfmeterschiessen: null, sonderereignis: "nichtantreten_team2" as const },
    torschuetzen: [],
    karten: [],
    bemerkungen: null,
  },
};

beforeEach(() => {
  eingabe = "off";
  calls.length = 0;
});

describe("the administrator's report correction", () => {
  /* The switch closes the administrator's write too: it enters pupils into a report as the referee's does. */
  it("answers the closed refusal and sends nothing while the switch reads off", async () => {
    answerWith(() => Promise.resolve(spielberichtReadFixture()));

    assert.deepEqual(await patchAdminSpielberichtAction(BERICHT_SPIEL_ID, BERICHT), {
      success: false,
      error: SPIELBERICHT_GESCHLOSSEN_REFUSAL,
    });
    assert.deepEqual(calls, [], "a correction reached the backend with the switch off");
  });

  it("refuses a no-show proposal carrying goals before the backend, once the switch reads on", async () => {
    eingabe = "on";

    const answer = await patchAdminSpielberichtAction(BERICHT_SPIEL_ID, BERICHT);

    assert.equal(answer.success, false);
    assert.deepEqual(calls, [], "a proposal the backend refuses reached it");
  });

  /* The control the closed case needs: an action hard-wired closed passes it too. */
  it("sends the whole block to the fixture named in the path once the switch reads on", async () => {
    eingabe = "on";
    answerWith(() => Promise.resolve(spielberichtReadFixture()));
    const offen = {
      bericht: { ...BERICHT.bericht, ergebnis_vorschlag: { ...BERICHT.bericht.ergebnis_vorschlag, team1_tore: null, team2_tore: null } },
    };

    const answer = await patchAdminSpielberichtAction(BERICHT_SPIEL_ID, offen);

    assert.equal(answer.success, true);
    assert.deepEqual(requestsOf(calls), [{ endpoint: `/spielberichte/${BERICHT_SPIEL_ID}`, method: "PATCH", body: offen }]);
  });

  it("answers every published refusal of the correction in the administrator's words", async () => {
    eingabe = "on";
    await assertEachAnswered({
      operation: "PATCH /spielberichte/{spiel_id}",
      refuseWith: answerWith,
      act: () =>
        patchAdminSpielberichtAction(BERICHT_SPIEL_ID, {
          bericht: { ...BERICHT.bericht, ergebnis_vorschlag: { ...BERICHT.bericht.ergebnis_vorschlag, team1_tore: null, team2_tore: null } },
        }),
      mapped: (refusal) => mapSpielberichtRefusal(refusal, "admin"),
    });
  });

  /* The step-up sweep cannot open the switch for its own config, so the backend's confirmation refusal is driven here
     (`fl_frontend/src/shared/utils/adminStepUp.test.ts :: CONFIRMED_IN_ITS_OWN_SUITE`). */
  it("answers the backend's confirmation refusal as the passkey prompt, and reads the page's figure again", async () => {
    eingabe = "on";
    setFresh(true);
    cacheCalls.length = 0;
    answerWith(() => Promise.reject(refusedOn("PATCH /spielberichte/{spiel_id}", "REQ-AUTH-009")));
    const offen = {
      bericht: { ...BERICHT.bericht, ergebnis_vorschlag: { ...BERICHT.bericht.ergebnis_vorschlag, team1_tore: null, team2_tore: null } },
    };

    assert.deepEqual(await patchAdminSpielberichtAction(BERICHT_SPIEL_ID, offen), stepUpRequired());
    assert.deepEqual(
      cacheCalls.map((call) => call.name),
      ["refresh"],
      "the refusal left the page's figure standing, so its next press is refused again",
    );
  });
});
