import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { TEAM_FACETS, TEAMS_ANY_SAISON_QUERY } from "@/features/teams/facets";
import { applyFacets, readFacetSelection } from "@/shared/utils/facets";
import { withSaisonId } from "@/shared/utils/saisonHref";

import type { AdminTeamRow } from "@/features/teams/types";

const TABLE = readFileSync(path.resolve(import.meta.dirname, "components", "collections", "AdminSpielerTable.tsx"), "utf8");

const TEAM_NAME = "Carl-Schurz-Schule";
const SAISON_ID = "68b0f1c2d3e4a5b6c7d8e9f0";

/** As the club list builds a row: `selected` is the SELECTED season's junction data, absent for a club it does not hold. */
function club(id: string, inSaison: boolean): AdminTeamRow {
  return {
    id,
    name: TEAM_NAME,
    full_name: TEAM_NAME,
    shorthand: "CSS",
    inactive_since: null,
    selected: inSaison ? { gruppe: "A", austritt: null } : null,
    isRetireable: false,
  };
}

const INSIDE = club("inside", true);
const OUTSIDE = club("outside", false);

/** The row link's own template, so what is decoded below is the URL the table builds rather than a copy of it. */
const HREF_TEMPLATE = /href=\{withSaisonId\(`(\/admin\/teams\?[^`]*)`/.exec(TABLE)?.[1] ?? "";

/** The template with its interpolations filled in. An interpolation this does not name is left in place, which the case below reads. */
// Composed by the SHIPPING helper: what has to hold is that the season lands in the query.
const HREF = withSaisonId(
  HREF_TEMPLATE.replace("${encodeURIComponent(row.teamName)}", encodeURIComponent(TEAM_NAME))
    .replace("${TEAMS_ANY_SAISON_QUERY}", TEAMS_ANY_SAISON_QUERY)
    .replace("${TEAMS_ANY_SAISON_QUERY}", TEAMS_ANY_SAISON_QUERY),
  SAISON_ID,
);

const query = (href: string): URLSearchParams => new URLSearchParams(href.slice(href.indexOf("?") + 1));

/** The club list's own two stages, in its order: the facets narrow, and the search field narrows what they left. */
const shown = (href: string, rows: AdminTeamRow[]): AdminTeamRow[] =>
  applyFacets(rows, TEAM_FACETS, readFacetSelection(TEAM_FACETS, query(href)));

describe("the squad row's link into the club list", () => {
  /* First: a template the regex stopped finding is an empty string, and every case below would then
     decode nothing and pass. */
  it("is read out of the table rather than restated here", () => {
    assert.notEqual(HREF_TEMPLATE, "", `AdminSpielerTable.tsx: no /admin/teams link to read`);
    assert.ok(!HREF.includes("${"), `AdminSpielerTable.tsx: the link carries ${HREF}, whose interpolation this guard cannot fill in`);
  });

  /* The defect this closes: a club replacement takes a club out of the season and leaves the squad
     rows naming it, so the one link that exists to reach it landed on an empty list. */
  it("reaches a club the selected season no longer holds", () => {
    assert.deepEqual(
      shown(HREF, [INSIDE, OUTSIDE]).map((team) => team.id),
      ["inside", "outside"],
      "the link narrows the club list to the selected season",
    );
  });

  it("still reaches a club the selected season holds", () => {
    assert.deepEqual(
      shown(HREF, [INSIDE]).map((team) => team.id),
      ["inside"],
    );
  });

  /* What the parameter above has to outrank. Asserted here so the link's reason is pinned beside the
     link, rather than left to whoever next reads the facet's default. */
  it("carries the parameter because the list's own default narrows to the season", () => {
    assert.deepEqual(
      shown(`/admin/teams?q=${encodeURIComponent(TEAM_NAME)}&saison_id=${SAISON_ID}`, [INSIDE, OUTSIDE]).map((team) => team.id),
      ["inside"],
    );
  });

  /* `name` is one of the club list's search keys, so the field it lands in shows the club's own name
     and a reader can widen the result from there. */
  it("hands the search field the club's name unencoded", () => {
    assert.equal(query(HREF).get("q"), TEAM_NAME);
  });

  /* The reverse link keys on the club's id and the season's clubs are that facet's options, so a club
     outside the season drops out and the player list widens instead of emptying. */
  it("leaves the club's own link back to the players alone", () => {
    const back = readFileSync(path.resolve(import.meta.dirname, "..", "teams", "components", "collections", "AdminTeamsTable.tsx"), "utf8");

    assert.match(back, /href=\{withSaisonId\(`\/admin\/spieler\?team=\$\{team\.id\}`, selectedFromUrl\)\}/);
  });
});
