import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement as h } from "react";
/* No public export carries either context — the bar's `useUrlFilters` reads the first and every
   `useSearchParams` the second. A Next release that moves either module fails this file at import. */
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime.js";
import { SearchParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime.js";

import { render, screen } from "@testing-library/react";

import { nextRouter } from "@/shared/testing/nextContexts.ts";

import type { FLSpiel } from "../../schemas.ts";

/* `await import`, never a static import beside the harness (`docs/frontend/spec.md` §1.9). */
const { SpielsucheView } = await import("./SpielsucheView.tsx");

type ViewProps = Parameters<typeof SpielsucheView>[0];

const ALPHA = "6890a1b2c3d4e5f607184011";
/** A club entered nowhere this season's fixtures reach. */
const GAMMA = "6890a1b2c3d4e5f607184013";
const NORD = "6890a1b2c3d4e5f607184021";
const SUED = "6890a1b2c3d4e5f607184022";
const BEISPIEL = "6890a1b2c3d4e5f607184032";
/** Well-formed, and naming nothing any list holds. */
const NIEMAND = "6890a1b2c3d4e5f6071840ff";

/** The one fixture of the season on screen, so a filter narrowing to nothing is told apart from an empty season. */
const SPIEL: FLSpiel = {
  id: "6890a1b2c3d4e5f607184001",
  spieltag_id: "6890a1b2c3d4e5f607184041",
  team1: { team_id: ALPHA, name: "FC Alpha", shorthand: "AL", tore: null, austritt_type: null },
  team2: { team_id: "6890a1b2c3d4e5f607184012", name: "SV Beta", shorthand: "BE", tore: null, austritt_type: null },
  team1_quelle: null,
  team2_quelle: null,
  datum: "2026-08-01",
  uhrzeit: "18:00",
  ort: { spielort_id: NORD, name: "Sportpark Nord", maps_link: "Sportpark Nord, Frankfurt" },
  schiedsrichter: { schiedsrichter_id: "6890a1b2c3d4e5f607184031", name: "Pierluigi Collina" },
  ergebnis: null,
  elfmeterschiessen: null,
  spiel_nr: 1,
  sonderereignis: null,
  saison_phase: "gruppenphase",
  saison_id: "2526",
  notiz: null,
};

/** The public route's props: its tier reads the season's clubs and no venue or referee list. */
const OEFFENTLICH: ViewProps = {
  spiele: [SPIEL],
  today: "2026-07-29",
  isFinishedSaison: false,
  teams: [
    { id: ALPHA, name: "FC Alpha" },
    { id: GAMMA, name: "TSV Gamma" },
  ],
};

/** The admin route's props: every venue and referee as well. */
const ADMIN: ViewProps = {
  ...OEFFENTLICH,
  isAdmin: true,
  spielorte: [
    { id: NORD, name: "Sportpark Nord" },
    { id: SUED, name: "Sportplatz Süd" },
  ],
  schiedsrichter: [{ id: BEISPIEL, name: "Rafael Beispiel" }],
};

const renderView = (query: string, props: ViewProps = ADMIN) =>
  render(
    h(AppRouterContext.Provider, {
      value: nextRouter(),
      children: h(SearchParamsContext.Provider, { value: new URLSearchParams(query), children: h(SpielsucheView, props) }),
    }),
  );

const PROMPT = "Suche nach einem Spiel oder setze einen Filter.";

describe("a link naming a value no fixture of the season holds", () => {
  /* The referee list's „Einsätze anzeigen“ opens the running season, where the referee may have officiated
     nothing: the page still has to say whose fixtures it was asked for, and that none match. */
  it("keeps the club, venue or referee as a pill under its own name, and says nothing matches", () => {
    for (const [query, pill] of [
      [`schiedsrichter=${BEISPIEL}`, "Schiedsrichter: Rafael Beispiel"],
      [`team=${GAMMA}`, "Team: TSV Gamma"],
      [`ort=${SUED}`, "Ort: Sportplatz Süd"],
    ] as const) {
      const { unmount } = renderView(query);

      screen.getByRole("button", { name: `${pill} ändern` });
      screen.getByText("Keine Spiele für diese Filter.");
      unmount();
    }
  });

  it("keeps a club on the public route, and drops a venue its tier reads no list of", () => {
    const { unmount } = renderView(`team=${GAMMA}`, OEFFENTLICH);
    screen.getByRole("button", { name: "Team: TSV Gamma ändern" });
    unmount();

    renderView(`ort=${SUED}`, OEFFENTLICH);
    assert.ok(screen.queryByRole("button", { name: /^Ort: / }) === null, "a venue no list labels is kept as a pill");
    screen.getByText(PROMPT);
  });

  /* The other half of the kept value, which a view keeping every value would pass. */
  it("drops an id naming nothing that exists, and prompts for a search", () => {
    renderView(`schiedsrichter=${NIEMAND}`);

    assert.ok(screen.queryByRole("button", { name: /^Schiedsrichter: / }) === null, "a referee no list labels is kept as a pill");
    screen.getByText(PROMPT);
  });
});

describe("the sentence under the bar", () => {
  it("draws none where a filter finds a fixture", () => {
    renderView(`team=${ALPHA}`);

    screen.getByRole("button", { name: "Team: FC Alpha ändern" });
    assert.ok(screen.queryByText(/^Keine Spiele|^Suche nach/) === null, "a list with rows still shows an empty state");
  });

  // Every other list closes its empty sentence with a full stop.
  it("names the search that found nothing, closed like every other list's sentence", () => {
    renderView("q=zzzzzz");

    screen.getByText("Keine Spiele für „zzzzzz“.");
  });
});
