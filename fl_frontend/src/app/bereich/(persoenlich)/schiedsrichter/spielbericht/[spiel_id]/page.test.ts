import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { createElement as h } from "react";

import { registerDoubles } from "@/core/exportingModule.ts";
import { person } from "@/core/subjectFixtures.ts";
import { doubleEveryAction, doubleSubjectLookup } from "@/shared/testing/actionDoubles.ts";
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
const { setSubject } = doubleSubjectLookup(person({ schiedsrichter: [{ schiedsrichter_id: SCHIEDSRICHTER_ID }] }));
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
    assert.ok(text.includes("Der Spielbericht ist gerade nicht freigeschaltet"), text);
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

    for (const [spiel, satz] of [
      [{ ...lesen.spiel, datum: "2099-01-01" }, "Dieses Spiel hat noch nicht stattgefunden."],
      [{ ...lesen.spiel, datum: null }, "Dieses Spiel hat noch kein Datum."],
      [{ ...lesen.spiel, sonderereignis: "ausgefallen" as const }, "Dieses Spiel ist ausgefallen oder annulliert."],
    ] as const) {
      answering({ ...lesen, spiel });
      const { text } = await rendered();

      assert.ok(text.includes(satz), text);
      assert.ok(!text.includes("Tor hinzufügen"), `the form renders beside „${satz}“`);
    }
  });

  /* After the fixture's season the backend refuses the referee's write and serves no squad: a form would offer pickers
     with nobody in them and a save that is refused. */
  it("shows the report read-only once the fixture's season has ended", async () => {
    eingabe = "on";
    answering({ ...LESEN, abgeschlossen: true, kader: { team1: [], team2: [] }, genannt: [...LESEN.kader.team1, ...LESEN.kader.team2] });

    const { text } = await rendered();

    assert.ok(text.includes("Die Saison dieses Spiels ist vorbei."), text);
    assert.ok(text.includes("9 · Lina Berg"), "the scorer the report names is not shown by name");
    assert.ok(!text.includes("Tor hinzufügen") && !text.includes("Speichern"), "the form renders after the season");
  });

  /* Parse, not cast: an arbitrary segment would become a backend request the backend answers with a routing 404, which
     the page cannot tell from a fault, and a decoded `/` or `?` would reshape the endpoint it names. */
  it("answers a segment that is no id with a 404 and reads nothing", async () => {
    eingabe = "on";
    answering(LESEN);
    clearSteps();

    const { thrown } = await callPage(SchiedsrichterSpielberichtPage, {
      params: Promise.resolve({ spiel_id: `${BERICHT_SPIEL_ID}/admin?` }),
      searchParams: Promise.resolve({}),
    });

    assert.ok(
      thrown.some((error) => (error as { digest?: unknown } | null)?.digest === "NEXT_HTTP_ERROR_FALLBACK;404"),
      "the page answered no 404",
    );
    assert.deepEqual(readsOf(steps), [], "a segment that is no id reached the backend");
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
