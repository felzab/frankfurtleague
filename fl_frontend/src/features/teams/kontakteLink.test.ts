import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement as h } from "react";

import { render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { doubleEveryAction } from "@/shared/testing/actionDoubles.ts";
import { underNext } from "@/shared/testing/nextContexts.ts";
import { applyFacets, readFacetSelection } from "@/shared/utils/facets";

import { buildKontakteFacets } from "./facets.ts";
import { FLTeamWithMembershipsSchema } from "./schemas.ts";
import { buildKontaktRows } from "./utils.ts";

import type { FLKontaktperson, FLSaisonTeamKontakte, FLTeamMembership, FLTeamWithMemberships } from "./schemas.ts";
import type { AdminTeamRow } from "./types.ts";

doubleEveryAction();

const { AdminTeamsTable } = await import("./components/collections/AdminTeamsTable.tsx");

const SAISON = "2026";

const person = (vorname: string): FLKontaktperson => ({
  vorname: vorname,
  nachname: "Mustermann",
  email: `${vorname.toLowerCase()}@beispiel.de`,
  telefon: "069 1234567",
  geburtsdatum: "1990-01-01",
  einwilligung: { umfang: "kontaktdaten", erfasst_von: "person", text_version: "2026-08", datum: "2026-08-01", bestaetigt_am: "2026-08-02" },
});

const MEMBERSHIP: FLTeamMembership = {
  saison_id: SAISON,
  gruppe: "A",
  austritt: null,
  trikot_farbe: null,
  kontakte: null,
  kontakte_stand: "",
};

/** Complete and parsed at construction: a drifted field fails where the fixture is built rather than wherever it is read. */
const CLUB: FLTeamWithMemberships = FLTeamWithMembershipsSchema.parse({
  id: "6890a1b2c3d4e5f607180001",
  name: "Goethe",
  shorthand: "GO",
  full_name: "Goethe",
  description: "",
  website_url: null,
  address: { strasse: "A", hausnummer: "1", plz: "60311", stadtteil: "Mitte", stadt: "Frankfurt" },
  schulform: null,
  inactive_since: null,
  memberships: [MEMBERSHIP],
} satisfies FLTeamWithMemberships);

const club = (id: string, name: string, kontakte: FLSaisonTeamKontakte): FLTeamWithMemberships => ({
  ...CLUB,
  id: id,
  name: name,
  shorthand: name.slice(0, 2).toUpperCase(),
  full_name: name,
  memberships: [{ ...MEMBERSHIP, kontakte: kontakte }],
});

const seats = (): FLSaisonTeamKontakte => ({
  trainer: person("Tim"),
  ansprechperson: person("Erika"),
  stellvertretung: null,
  trainer_ist_zugleich: null,
});

const ROWS = buildKontaktRows([club("gezielt", "Goethe", seats()), club("daneben", "Helmholtz", seats())], SAISON);
const FACETS = buildKontakteFacets(ROWS.map((row) => ({ teamId: row.teamId, name: row.teamName })));

/** The club „Goethe“ as the club list draws its row, in the season the selector names. */
const ROW: AdminTeamRow = {
  id: "gezielt",
  name: "Goethe",
  full_name: "Goethe",
  shorthand: "GO",
  inactive_since: null,
  selected: { gruppe: "A", austritt: null },
  isRetireable: false,
  publicSaisonId: SAISON,
};

/** The link the row's overflow menu offers into the contacts list, read off the opened menu. */
async function contactsLink(): Promise<string> {
  const { unmount } = render(
    underNext(h(AdminTeamsTable, { filteredTeams: [ROW], emptiness: "none", setDeletingTeam: () => undefined }), {
      search: `saison_id=${SAISON}`,
    }),
  );
  const table = screen.getByRole("grid", { name: "Tabelle aller Teams" });
  await userEvent.setup().click(within(table).getByRole("button", { name: `Weitere Aktionen für Team ${ROW.name}` }));

  const href = within(screen.getByRole("menu")).getByRole("menuitem", { name: "Kontakte anzeigen" }).getAttribute("href") ?? "";
  unmount();

  return href;
}

const HREF = await contactsLink();

const query = (href: string): URLSearchParams => new URLSearchParams(href.slice(href.indexOf("?") + 1));

describe("the contacts link the club list offers", () => {
  it("builds a link into the contacts list at all", () => {
    assert.ok(HREF.startsWith("/admin/kontakte?"), `the menu links the contacts to ${HREF}`);
    assert.equal(ROWS.length, 2, "the fixture no longer holds two clubs, so filtering proves nothing");
  });

  /* Run through the list's OWN facet machinery rather than compared as text: a link naming a
     parameter the facet does not declare filters nothing, and every string assertion still passes. */
  it("narrows the contacts list to the club it was pressed on", () => {
    const shown = applyFacets(ROWS, FACETS, readFacetSelection(FACETS, query(HREF)));

    assert.deepEqual(
      shown.map((row) => row.teamId),
      ["gezielt"],
      "the link leaves clubs in the list it was not pressed on",
    );
  });

  /* The seats hang off the junction, so a link that drops the season opens another season's people —
     silently, because the list still renders three seats for whatever season resolves instead. */
  it("carries the selected season alongside the club", () => {
    assert.equal(query(HREF).get("saison_id"), SAISON, "the contacts link drops the season it was pressed in");
  });
});
