import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement as h } from "react";

import { render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { TEAM_FACETS } from "@/features/teams/facets";
import { doubleEveryAction } from "@/shared/testing/actionDoubles.ts";
import { underNext } from "@/shared/testing/nextContexts.ts";
import { applyFacets, readFacetSelection } from "@/shared/utils/facets";

import type { AdminTeamRow } from "@/features/teams/types";
import type { AdminSpielerRow } from "./types.ts";

doubleEveryAction();

const { AdminSpielerTable } = await import("./components/collections/AdminSpielerTable.tsx");
const { AdminTeamsTable } = await import("@/features/teams/components/collections/AdminTeamsTable.tsx");

const TEAM_NAME = "Carl-Schurz-Schule";
const SAISON_ID = "68b0f1c2d3e4a5b6c7d8e9f0";
const TEAM_ID = "68b0f1c2d3e4a5b6c7d8e9a1";

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
    publicSaisonId: inSaison ? SAISON_ID : null,
  };
}

const INSIDE = club("inside", true);
const OUTSIDE = club("outside", false);

/** A player whose squad row this season names the club, which is the row the link is drawn on. */
const SPIELER: AdminSpielerRow = {
  id: "68b0f1c2d3e4a5b6c7d8e9b1",
  vorname: "Jule",
  nachname: "Meier",
  fullName: "Jule Meier",
  inactive_since: null,
  selected: {
    team_id: TEAM_ID,
    nummer: "7",
    position: null,
    stufe: null,
    ist_nachnominiert: false,
    rolle: null,
    inactive_since: null,
    teamName: TEAM_NAME,
    teamShorthand: "CSS",
  },
};

/** The link the squad row draws on the club's name, read off the rendered list under the selector's season. */
function squadRowLink(): string {
  const { unmount } = render(
    underNext(
      h(AdminSpielerTable, {
        filteredSpieler: [SPIELER],
        emptiness: "none",
        saisonTeams: [],
        selectedSaisonId: SAISON_ID,
        setDeletingSpieler: () => undefined,
      }),
      { search: `saison_id=${SAISON_ID}` },
    ),
  );
  // Both layouts draw the row, and both links have to agree.
  const hrefs = new Set(screen.getAllByRole("link", { name: TEAM_NAME }).map((link) => link.getAttribute("href") ?? ""));
  unmount();

  assert.equal(hrefs.size, 1, `the two layouts link the club differently: ${[...hrefs].join(" | ")}`);
  return [...hrefs][0] ?? "";
}

const HREF = squadRowLink();

const query = (href: string): URLSearchParams => new URLSearchParams(href.slice(href.indexOf("?") + 1));

/** The club list's own two stages, in its order: the facets narrow, and the search field narrows what they left. */
const shown = (href: string, rows: AdminTeamRow[]): AdminTeamRow[] =>
  applyFacets(rows, TEAM_FACETS, readFacetSelection(TEAM_FACETS, query(href)));

describe("the squad row's link into the club list", () => {
  it("points into the club list", () => {
    assert.ok(HREF.startsWith("/admin/teams?"), `the club's name links to ${HREF}`);
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
  it("leaves the club's own link back to the players keyed on the club and the season", async () => {
    render(
      underNext(h(AdminTeamsTable, { filteredTeams: [{ ...INSIDE, id: TEAM_ID }], emptiness: "none", setDeletingTeam: () => undefined }), {
        search: `saison_id=${SAISON_ID}`,
      }),
    );
    const table = screen.getByRole("grid", { name: "Tabelle aller Teams" });
    await userEvent.setup().click(within(table).getByRole("button", { name: `Weitere Aktionen für Team ${TEAM_NAME}` }));

    const back = within(screen.getByRole("menu")).getByRole("menuitem", { name: "Spieler anzeigen" }).getAttribute("href") ?? "";

    assert.equal(back, `/admin/spieler?team=${TEAM_ID}&saison_id=${SAISON_ID}`);
  });
});
