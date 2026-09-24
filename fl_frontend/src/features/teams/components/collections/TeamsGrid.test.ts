import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement as h } from "react";
/* No public export carries the router context, and every card's `Link` reads it. A Next release that
   moves the module fails this file at import rather than quietly. */
// eslint-disable-next-line no-restricted-imports -- not moved onto shared/testing/nextContexts.ts yet
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime.js";

import { FLTeamSchema } from "@/features/teams/schemas.ts";
import { nextRouter } from "@/shared/testing/nextContexts.ts";
import { renderTree } from "@/shared/testing/renderTest.ts";

/* Reached with `await import` and never a static import beside the harness, which registers the JSX
   compile step as it evaluates (`docs/frontend/spec.md` §1.9). */
const { TeamsGrid } = await import("./TeamsGrid.tsx");

/** Parsed at construction, so a drifted field fails where the fixture is built. */
const TEAM = FLTeamSchema.parse({
  id: "6890a1b2c3d4e5f607190041",
  name: "Carlo-Mierendorff",
  gruppe: "A",
  austritt: null,
  shorthand: "CM",
  description: "",
  full_name: "Carlo-Mierendorff-Schule",
  website_url: null,
  address: { strasse: "Weg", hausnummer: "1", plz: "60435", stadtteil: "Preungesheim", stadt: "Frankfurt am Main" },
  schulform: null,
  inactive_since: null,
  statistik: {
    anzahl_gespielte_spiele: 15,
    siege: 15,
    niederlagen: 0,
    unentschieden: 0,
    tore_geschossen: 100,
    tore_kassiert: 0,
    punkte: 45,
    anzahl_abgesagte_spiele: 0,
  },
});

describe("the club cards' headings", () => {
  /* The page's `h1` sits above the grid, so a club's name one level deeper is the outline a screen
     reader's heading list reads; a level skipped there reads as a section gone missing. */
  it("name each club at the level under the page's own heading", () => {
    const markup = renderTree(
      h(
        AppRouterContext.Provider,
        { value: nextRouter() },
        h(TeamsGrid, { teams: [TEAM], urlPrefix: "/dashboard/teams", saisonId: undefined, isFinishedSaison: false }),
      ),
    );

    assert.match(markup, new RegExp(`<h2\\b[^>]*>${TEAM.name}</h2>`));
    assert.doesNotMatch(markup, /<h[3-6]\b/);
  });
});
