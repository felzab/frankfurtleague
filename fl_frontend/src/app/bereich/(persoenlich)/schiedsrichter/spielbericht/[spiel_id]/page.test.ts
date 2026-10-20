import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { createElement as h } from "react";

import { registerDoubles } from "@/core/exportingModule.ts";
import { person } from "@/core/subjectFixtures.ts";
import { doubleActionRequest, doubleEveryAction } from "@/shared/testing/actionDoubles.ts";
import { underNext } from "@/shared/testing/nextContexts.ts";
import {
  answerReadsWith,
  callPage,
  clearSteps,
  EMPTIEST_ANSWER,
  readsOf,
  redirectTarget,
  renderPage,
  steps,
} from "@/shared/testing/pageHarness.ts";
import { textOf } from "@/shared/testing/renderTest.ts";
import { BERICHT_SPIEL_ID, spielberichtReadFixture } from "@/shared/testing/spielberichtFixtures.ts";

import type { FLSpielberichtSchiedsrichterResponse } from "@/features/spielberichte/schemas.ts";

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
const { setSubject } = doubleActionRequest({ session: null, subject: person({ schiedsrichter: [{ schiedsrichter_id: SCHIEDSRICHTER_ID }] }) });
doubleEveryAction();

/* `await import`, never a static import beside the harness (`docs/frontend/spec.md` §1.9). */
const { default: SchiedsrichterSpielberichtPage } = await import("./page.tsx");
const { refusedOn } = await import("@/shared/testing/publishedRefusals.ts");
const { FLSpielberichtSchiedsrichterResponseSchema } = await import("@/features/spielberichte/schemas.ts");

/** The fixture through the referee's mirror, so a case varies a typed read. */
const LESEN = FLSpielberichtSchiedsrichterResponseSchema.parse(spielberichtReadFixture());

const PROPS = { params: Promise.resolve({ spiel_id: BERICHT_SPIEL_ID }), searchParams: Promise.resolve({}) };
const ENDPOINT = `/spielberichte/${BERICHT_SPIEL_ID}/bericht`;

const answering = (read: FLSpielberichtSchiedsrichterResponse) =>
  answerReadsWith((endpoint, schema, params) => (endpoint === ENDPOINT ? read : EMPTIEST_ANSWER(endpoint, schema, params)));

/** The page as its render leaves it, as text, with every backend read the render made. */
async function rendered(): Promise<{ text: string; reads: string[] }> {
  clearSteps();
  const markup = await renderPage(underNext(h(SchiedsrichterSpielberichtPage, PROPS)));
  return { text: textOf(markup, " "), reads: readsOf(steps).map(({ endpoint }) => endpoint) };
}

beforeEach(() => {
  eingabe = "off";
  setSubject(person({ schiedsrichter: [{ schiedsrichter_id: SCHIEDSRICHTER_ID }] }));
  answerReadsWith(EMPTIEST_ANSWER);
});

describe("the referee's report page", () => {
  /* The form is one of the paths entering a pupil into a report, so the switch closes it before anything is read. */
  it("renders the closed state and reads nothing while the switch reads off", async () => {
    const { text, reads } = await rendered();

    assert.deepEqual(reads, []);
    assert.ok(text.includes("Der Spielbericht ist noch nicht freigeschaltet"), text);
    assert.ok(!text.includes("Tor hinzufügen"), "the form renders with the switch off");
  });

  it("opens the form on the fixture's report once the switch reads on", async () => {
    eingabe = "on";
    answering(LESEN);

    const { text, reads } = await rendered();

    assert.deepEqual(reads, [ENDPOINT]);
    for (const wert of ["Goethe-Gymnasium gegen Lessing-Gymnasium", "Torschützen", "Karten", "Bemerkungen"])
      assert.ok(text.includes(wert), `„${wert}“ is missing`);
  });

  /* The backend's refusal of the PUT, foreseen from the fixture the read serves, so the referee meets no form it refuses. */
  it("offers no form on a fixture still to be played or called off", async () => {
    eingabe = "on";
    const lesen = LESEN;

    answering({ ...lesen, spiel: { ...lesen.spiel, datum: "2099-01-01" } });
    assert.ok((await rendered()).text.includes("Dieses Spiel hat noch nicht stattgefunden."));

    answering({ ...lesen, spiel: { ...lesen.spiel, sonderereignis: "ausgefallen" } });
    assert.ok((await rendered()).text.includes("Dieses Spiel ist ausgefallen oder annulliert."));
  });

  it("tells a referee the fixture is booked to somebody else, and sends one whose record went to the landing", async () => {
    eingabe = "on";
    answerReadsWith(() => {
      throw refusedOn(`GET /spielberichte/{spiel_id}/bericht`, "REQ-BERICHT-002");
    });
    assert.ok((await rendered()).text.includes("Dieses Spiel leitest Du nicht mehr."));

    answerReadsWith(() => {
      throw refusedOn(`GET /spielberichte/{spiel_id}/bericht`, "REQ-FUNKTION-001");
    });
    const { thrown } = await callPage(SchiedsrichterSpielberichtPage, PROPS);
    assert.deepEqual(
      thrown.flatMap((error) => redirectTarget(error) ?? []),
      ["/bereich"],
    );
  });
});
