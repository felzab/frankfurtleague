import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { applyFacets, readFacetSelection } from "@/shared/utils/facets";

// Relative import, not the "@/" alias: Node's resolver does not read tsconfig paths.
import { orderStufen, STUFE_OPTIONS } from "./constants.ts";
import { buildSpielerFacets, SPIELER_FACETS } from "./facets.ts";

import type { FLSpielerStufe } from "./schemas.ts";
import type { AdminSpielerRow, SpielerTeamOption } from "./types.ts";

/** One club, because the builder answers with the constant itself for an empty list. */
const TEAMS: readonly SpielerTeamOption[] = [{ teamId: "6890a1b2c3d4e5f607190001", name: "Helmholtz", shorthand: "HE" }];

/** What the player list hands the filter bar, which is the set an admin actually filters on. */
const OFFERED = buildSpielerFacets(TEAMS);

const STUFE_FACET = SPIELER_FACETS.find((facet) => facet.param === "stufe");
const OFFERED_STUFE_FACET = OFFERED.find((facet) => facet.param === "stufe");

/** A season narrowed after its squads were filled: the two `E` levels are out of its rules. */
const NARROWED_SAISON: readonly FLSpielerStufe[] = ["Q1", "Q2", "Q3", "Q4"];

/** As the list builds a row: `selected` is the chosen season's junction row, live and in a squad. */
function squadRow(id: string, stufe: FLSpielerStufe): AdminSpielerRow {
  return {
    id: id,
    vorname: "X",
    nachname: null,
    fullName: "X",
    inactive_since: null,
    selected: {
      team_id: TEAMS[0]!.teamId,
      nummer: null,
      position: null,
      stufe: stufe,
      is_nachgetragen: false,
      rolle: null,
      inactive_since: null,
      teamName: TEAMS[0]!.name,
      teamShorthand: TEAMS[0]!.shorthand,
    },
  };
}

const ON_A_DROPPED_STUFE = squadRow("dropped", "E1");
const ON_AN_ALLOWED_STUFE = squadRow("allowed", "Q1");

describe("the level filter the players list offers", () => {
  /* First: a facet neither cut finds would leave every assertion below reading `undefined`. */
  it("offers the level as a facet at all, in the constant and in the built set", () => {
    assert.ok(STUFE_FACET, "no facet of `SPIELER_FACETS` reads the level parameter");
    assert.ok(OFFERED_STUFE_FACET, "no facet `buildSpielerFacets` returns reads the level parameter");
    assert.equal(STUFE_FACET.label, "Stufe");
  });

  /* Non-vacuity: were a season's own list the league's whole set, every case below would pass under
     the one edit they exist to refuse. */
  it("is a longer list than what a narrowed season allows", () => {
    assert.ok(
      orderStufen(NARROWED_SAISON).length < STUFE_OPTIONS.length,
      "the sample season allows every level there is, so nothing below is compared against a narrowing",
    );
  });

  /* `erlaubte_stufen` bounds the squad FORM and never a stored row (`docs/glossary.md :: stufe`), so
     a level a season dropped still stands in the table and has to stay filterable. */
  it("offers every level the league has, whatever the season allows", () => {
    assert.deepEqual(
      OFFERED_STUFE_FACET?.options.map((option) => option.value),
      [...STUFE_OPTIONS],
      "cut to a season's `erlaubte_stufen`, this filter offers no value that reaches a squad row on a level the season dropped",
    );
  });

  /* What an admin loses if it is cut: `readFacetSelection` drops a value the facet does not offer,
     so the row stands in the table with nothing in the panel or the URL able to single it out. */
  it("reaches a squad row on a level the season has since dropped", () => {
    const selection = readFacetSelection(OFFERED, new URLSearchParams("stufe=E1"));

    assert.deepEqual(selection.stufe, ["E1"], "`stufe=E1` selects nothing, so a level the season dropped cannot be filtered on at all");
    assert.deepEqual(applyFacets([ON_A_DROPPED_STUFE, ON_AN_ALLOWED_STUFE], OFFERED, selection), [ON_A_DROPPED_STUFE]);
  });

  /* The builder is the only place a season could reach this facet, and a narrowed copy is a new
     object however it was built — so identity is what refuses one. */
  it("hands the level facet through untouched rather than rebuilding it", () => {
    assert.ok(OFFERED.includes(STUFE_FACET!), "`buildSpielerFacets` rebuilt the level facet, which is how a season's narrowing would get in");
  });
});
