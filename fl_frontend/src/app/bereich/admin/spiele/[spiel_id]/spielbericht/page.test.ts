import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { createElement as h } from "react";

import { registerDoubles } from "@/core/exportingModule.ts";
import { doubleActionRequest, doubleEveryAction } from "@/shared/testing/actionDoubles.ts";
import { underNext } from "@/shared/testing/nextContexts.ts";
import { answerReadsWith, clearSteps, EMPTIEST_ANSWER, readsOf, renderPage, steps } from "@/shared/testing/pageHarness.ts";
import { textOf } from "@/shared/testing/renderTest.ts";
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

// An administrator's session: every admin-tier read resolves its actor from it before it is sent.
doubleActionRequest();
doubleEveryAction();

/* `await import`, never a static import beside the harness (`docs/frontend/spec.md` §1.9). */
const { default: AdminSpielberichtPage } = await import("./page.tsx");

const PROPS = { params: Promise.resolve({ spiel_id: BERICHT_SPIEL_ID }), searchParams: Promise.resolve({}) };
const ENDPOINT = `/spielberichte/${BERICHT_SPIEL_ID}/admin`;

/** The page as its render leaves it, as text, with every backend read the render made. */
async function rendered(): Promise<{ text: string; reads: string[] }> {
  clearSteps();
  const markup = await renderPage(underNext(h(AdminSpielberichtPage, PROPS), { search: "saison_id=2026" }));
  return { text: textOf(markup, " "), reads: readsOf(steps).map(({ endpoint }) => endpoint) };
}

/** The read as the backend answers it: both squads only where the read asks `kader`, empty otherwise. */
const gelesenWie = (params: Record<string, unknown>) => {
  const gelesen = spielberichtReadFixture();
  return params.kader === true ? gelesen : { ...gelesen, kader: { team1: [], team2: [] } };
};

beforeEach(() => {
  eingabe = "off";
  answerReadsWith((endpoint, schema, params) => (endpoint === ENDPOINT ? gelesenWie(params) : EMPTIEST_ANSWER(endpoint, schema, params)));
});

describe("the administrator's report correction page", () => {
  /* The correction enters pupils into a report as the referee's form does, so the switch closes it as well. */
  it("renders the closed state and no form while the switch reads off", async () => {
    const { text, reads } = await rendered();

    assert.deepEqual(reads, [ENDPOINT]);
    // Never „noch nicht“: the switch can go off again after the league opened it.
    assert.ok(text.includes("Spielberichte sind gerade nicht freigeschaltet"), text);
    assert.ok(!text.includes("Tor hinzufügen"), "the correction renders with the switch off");
  });

  /* The write refuses each of these (`REQ-BERICHT-001`, `-004`), so the page says so before a whole report is typed, as
     the referee's page does. */
  for (const [fall, spiel, satz, hinweis] of [
    [
      "called off",
      { sonderereignis: "ausgefallen" },
      "Das Spiel ist als ausgefallen oder annulliert eingetragen.",
      "Den Spielbericht bearbeitest Du, sobald Du das Sonderereignis im Spiel entfernst.",
    ],
    ["undated", { datum: null }, "Das Spiel hat noch kein Datum.", "Den Spielbericht bearbeitest Du ab dem Spieltag."],
    ["still to come", { datum: "2999-05-14" }, "Das Spiel hat noch nicht stattgefunden.", "Den Spielbericht bearbeitest Du ab dem Spieltag."],
  ] as const) {
    // The read holds a stored report: one written before the fixture moved or was called off stands, so no hint says none exists.
    it(`states a fixture ${fall} and offers no form, saying when the stored report is edited`, async () => {
      eingabe = "on";
      const gelesen = spielberichtReadFixture();
      answerReadsWith((endpoint, schema, params) =>
        endpoint === ENDPOINT ? { ...gelesen, spiel: { ...gelesen.spiel, ...spiel } } : EMPTIEST_ANSWER(endpoint, schema, params),
      );

      const { text } = await rendered();

      assert.ok(text.includes(satz), text);
      assert.ok(text.includes(hinweis), text);
      assert.ok(!text.includes("Tor hinzufügen"), `the correction renders for a fixture ${fall}`);
    });
  }

  it("opens the correction on the stored report once the switch reads on", async () => {
    eingabe = "on";

    const { text } = await rendered();

    for (const wert of ["Goethe-Gymnasium gegen Lessing-Gymnasium", "Tor hinzufügen", "Karte hinzufügen", "Bemerkungen zum Spiel"]) {
      assert.ok(text.includes(wert), `„${wert}“ is missing`);
    }
    // The form picks from both squads, which the read serves only where it asks for them.
    assert.ok(!text.includes("kein Kader hinterlegt"), "the correction opened on squads its read left empty");
  });
});
