import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { createElement as h } from "react";

import { cleanup, render, screen } from "@testing-library/react";

import { FLSpielSchema } from "@/features/spiele/schemas.ts";
import { spielFields } from "@/shared/testing/fixtures.ts";
import { underNext } from "@/shared/testing/nextContexts.ts";

import type { FLSpielberichtZustandEintrag } from "@/features/spielberichte/schemas.ts";

/* `await import`, never a static import beside the harness (`docs/frontend/spec.md` §1.9). */
const { AdminSpieleActionRequiredView } = await import("./AdminSpieleActionRequiredView.tsx");

/** A group fixture played yesterday with its result stored, the one a report reaches the triage on alone. */
const GESPIELT = FLSpielSchema.parse(spielFields({ datum: "2026-10-17", ergebnis: "3:1" }));

const bericht = (zustand: FLSpielberichtZustandEintrag["zustand"]): FLSpielberichtZustandEintrag => ({
  spiel_id: GESPIELT.id,
  zustand,
  ergebnis_vorschlag: { team1_tore: 3, team2_tore: 1, elfmeterschiessen: null, sonderereignis: null },
});

const triage = (spielberichte: readonly FLSpielberichtZustandEintrag[]) =>
  render(
    underNext(
      h(AdminSpieleActionRequiredView, {
        overviewSpiele: [GESPIELT],
        bracketFaults: [],
        spielberichte,
        today: "2026-10-18",
        isFinishedSaison: false,
      }),
      { search: "saison_id=2026&section=ergebnis_vorschlag" },
    ),
  );

afterEach(cleanup);

describe("the triage's reports", () => {
  /* The fixture already holds a result, so only the report's state files it: a correction after adoption included. */
  it("files a corrected report's fixture under its proposal, its card naming the state and the score", () => {
    triage([bericht("abweichend")]);

    assert.equal(screen.getByRole("tab", { name: /Vorschlag/ }).textContent, "Vorschlag1", "the fixture is not filed under the proposal");
    assert.ok(screen.getByText("Bericht geändert 3:1"), "the card does not say the report diverges");
  });

  it("files nothing and names nothing once the report is adopted", () => {
    triage([bericht("uebernommen")]);

    assert.equal(screen.getByRole("tab", { name: /Vorschlag/ }).textContent, "Vorschlag0");
    assert.equal(screen.queryAllByText(/Ergebnis vorgeschlagen|Bericht geändert/).length, 0, "an adopted report still chips its card");
  });
});
