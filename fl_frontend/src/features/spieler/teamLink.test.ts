import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement as h } from "react";

import { render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { FLSaisonSchema } from "@/features/saisons/schemas.ts";
import { FLTeamWithMembershipsSchema } from "@/features/teams/schemas";
import { doubleActionRequest, doubleEveryAction } from "@/shared/testing/actionDoubles.ts";
import { underNext } from "@/shared/testing/nextContexts.ts";
import { answer, answerReadsWith, EMPTIEST_ANSWER, pageBody, saisonFields } from "@/shared/testing/pageHarness.ts";

import type { AdminTeamRow } from "@/features/teams/types";
import type { ReactElement } from "react";
import type { AdminSpielerRow } from "./types.ts";

doubleEveryAction();
// An administrator's session, which every admin-tier read the club editor makes resolves its actor from.
doubleActionRequest();

const { AdminSpielerTable } = await import("./components/collections/AdminSpielerTable.tsx");
const { AdminTeamsTable } = await import("@/features/teams/components/collections/AdminTeamsTable.tsx");
const { default: AdminTeamEditPage } = await import("@/app/bereich/admin/teams/[team_id]/page.tsx");

const TEAM_NAME = "Carl-Schurz-Schule";
const SAISON_ID = "2526";
const TEAM_ID = "68b0f1c2d3e4a5b6c7d8e9a1";

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

/* A club replacement takes a club out of the season and leaves the squad rows naming it: the club
   behind the link holds no row of the season the link carries. */
answerReadsWith((endpoint, schema, params) => {
  if (endpoint === "/saisons/list/admin") {
    return answer(schema, endpoint, { saisons: [answer(FLSaisonSchema, endpoint, saisonFields(SAISON_ID, "active"))] });
  }
  if (endpoint === "/teams/memberships") {
    const club = answer(FLTeamWithMembershipsSchema, endpoint, {
      id: TEAM_ID,
      name: TEAM_NAME,
      shorthand: "CS",
      full_name: TEAM_NAME,
      address: { strasse: "Am Sportpark", hausnummer: "1", plz: "60435", stadtteil: "Nordend", stadt: "Frankfurt am Main" },
      memberships: [],
    });
    return answer(schema, endpoint, { teams: [club] });
  }
  return EMPTIEST_ANSWER(endpoint, schema, params);
});

describe("the squad row's link to its club", () => {
  /* The club's id and the season, and nothing a reader typed: a search query in a link is a request
     line the edge logs (`docs/frontend/spec.md :: I680`). */
  it("opens the club's own editor, keyed on the club and the season alone", () => {
    assert.equal(HREF, `/bereich/admin/teams/${TEAM_ID}?saison_id=${SAISON_ID}`);
  });

  /* The season's list of clubs holds no replaced club, so a link into that list would reach nothing:
     the editor at the link's address has to open the club all the same. */
  it("reaches a club the selected season does not hold", async () => {
    const address = new URL(HREF, "http://localhost");
    const body = await pageBody(AdminTeamEditPage, {
      params: Promise.resolve({ team_id: address.pathname.split("/").at(-1) ?? "" }),
      searchParams: Promise.resolve(Object.fromEntries(address.searchParams)),
    });
    const view = (body.props as { children: ReactElement<{ team: { id: string }; saison: { membership: unknown } }> }).children;

    assert.equal(view.props.team.id, TEAM_ID, "the link's address opens another club, or none");
    assert.equal(
      view.props.saison.membership,
      null,
      "the club the case opens still holds the season, so it proves nothing about a replaced one",
    );
  });

  /* The reverse link keys on the club's id and the season's clubs are that facet's options, so a club
     outside the season drops out and the player list widens instead of emptying. */
  it("leaves the club's own link back to the players keyed on the club and the season", async () => {
    const club: AdminTeamRow = {
      id: TEAM_ID,
      name: TEAM_NAME,
      full_name: TEAM_NAME,
      shorthand: "CSS",
      inactive_since: null,
      selected: { gruppe: "A", austritt: null },
      isRetireable: false,
      publicSaisonId: SAISON_ID,
    };
    render(
      underNext(h(AdminTeamsTable, { filteredTeams: [club], emptiness: "none", setDeletingTeam: () => undefined }), {
        search: `saison_id=${SAISON_ID}`,
      }),
    );
    const table = screen.getByRole("grid", { name: "Tabelle aller Teams" });
    await userEvent.setup().click(within(table).getByRole("button", { name: `Weitere Aktionen: Team ${TEAM_NAME}` }));

    const back = within(screen.getByRole("menu")).getByRole("menuitem", { name: "Spieler anzeigen" }).getAttribute("href") ?? "";

    assert.equal(back, `/bereich/admin/spieler?team=${TEAM_ID}&saison_id=${SAISON_ID}`);
  });
});
