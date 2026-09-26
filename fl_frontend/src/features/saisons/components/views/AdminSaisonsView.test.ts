import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement as h } from "react";

import { underNext } from "@/shared/testing/nextContexts.ts";
import { renderTree, textOf } from "@/shared/testing/renderTest.ts";

import type { FLSaisonRules, FLSaisonStatus } from "@/features/saisons/schemas.ts";
import type { AdminSaisonRow } from "@/features/saisons/types.ts";

/* Reached with `await import` and never a static import beside the harness, which registers the JSX
   compile step as it evaluates (`docs/frontend/spec.md` §1.9). */
const { AdminSaisonsView } = await import("./AdminSaisonsView.tsx");

const RULES: FLSaisonRules = {
  win_points: 3,
  draw_points: 1,
  qualifiers_per_group: 2,
  number_of_groups: 2,
  teams_per_group: 4,
  max_kadergroesse: 18,
  tiebreak_order: "tordifferenz",
  forfeit_ergebnis: { sieger_tore: 3, verlierer_tore: 0 },
  erlaubte_stufen: ["E1", "Q1"],
};

const saison = (id: string, status: FLSaisonStatus): AdminSaisonRow => ({
  id: id,
  start_date: `${id}-03-07`,
  end_date: `${id}-10-31`,
  status: status,
  rules: RULES,
});

const viewText = (saisons: AdminSaisonRow[]): string =>
  textOf(renderTree(underNext(h(AdminSaisonsView, { saisons: saisons }), { pathname: "/admin/saisons" })), " ")
    .replace(/\s+/g, " ")
    .trim();

describe("what the season list says while no season runs", () => {
  /* An empty league is sent here from the pages reading a season, and a list with no word about it
     reads as a redirect that went wrong. A league whose seasons are all planned or ended runs none either. */
  it("says no season is active, before any season exists and while every one is planned or ended", () => {
    for (const saisons of [[], [saison("2027", "future")], [saison("2025", "past"), saison("2027", "future")]]) {
      assert.match(viewText(saisons), /Derzeit ist keine Saison aktiv/, JSON.stringify(saisons.map(({ status }) => status)));
    }
  });

  /* Only an empty league leaves those pages nothing to show: before a first activation they open on the
     planned season. */
  it("asks for a season only where the league holds none", () => {
    const ANLEGEN = /Lege eine Saison an, damit Handlungsbedarf, Finalrunden und Spielsuche etwas zeigen\./;

    assert.match(viewText([]), ANLEGEN);
    for (const saisons of [[saison("2027", "future")], [saison("2025", "past")], [saison("2025", "past"), saison("2027", "future")]]) {
      const text = viewText(saisons);

      assert.match(text, /Derzeit ist keine Saison aktiv/, "the notice is gone, so the absence below proves nothing");
      assert.doesNotMatch(text, ANLEGEN, JSON.stringify(saisons.map(({ status }) => status)));
    }
  });

  /* The sentence names the planned season's page, so it stands only where one exists: an empty league
     and one holding ended seasons alone have no such page to send the admin to. */
  it("points to the planned season's page only where a planned season exists", () => {
    const UMSTELLUNG = /Umgestellt wird auf der Seite der geplanten Saison\./;

    for (const saisons of [[saison("2027", "future")], [saison("2025", "past"), saison("2027", "future")]]) {
      assert.match(viewText(saisons), UMSTELLUNG, JSON.stringify(saisons.map(({ status }) => status)));
    }
    for (const saisons of [[], [saison("2025", "past")]]) {
      const text = viewText(saisons);

      assert.match(text, /Derzeit ist keine Saison aktiv/, "the notice is gone, so the absence below proves nothing");
      assert.doesNotMatch(text, UMSTELLUNG, JSON.stringify(saisons.map(({ status }) => status)));
    }
  });

  /* The other half: a notice standing over a running league is a false alarm nobody reads twice. */
  it("says nothing of it while a season runs", () => {
    const text = viewText([saison("2026", "active"), saison("2027", "future")]);

    assert.doesNotMatch(text, /keine Saison aktiv/, "a running league announces that no season runs");
    assert.match(text, /2027/, "the view renders no row, so the absence above proves nothing");
  });
});
