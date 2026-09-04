import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { applyFacets, readFacetSelection } from "@/shared/utils/facets";
import { withSaisonId } from "@/shared/utils/saisonHref";

import { buildKontakteFacets } from "./facets.ts";
import { buildKontaktRows } from "./utils.ts";

import type { FLKontaktperson, FLSaisonTeamKontakte, FLTeamWithMemberships } from "./schemas.ts";

const TABLE = readFileSync(path.resolve(import.meta.dirname, "components", "collections", "AdminTeamsTable.tsx"), "utf8");

const SAISON = "2026";

const person = (vorname: string): FLKontaktperson => ({
  vorname: vorname,
  nachname: "Mustermann",
  email: `${vorname.toLowerCase()}@beispiel.de`,
  telefon: "069 1234567",
  geburtsdatum: "1990-01-01",
  einwilligung: { umfang: "kontaktdaten", erteilt_von: "person", text_version: "2026-08", datum: "2026-08-01", bestaetigt_am: "2026-08-02" },
});

const club = (id: string, name: string, kontakte: FLSaisonTeamKontakte): FLTeamWithMemberships =>
  ({
    id: id,
    name: name,
    shorthand: name.slice(0, 2).toUpperCase(),
    full_name: name,
    description: "",
    website_url: null,
    address: { strasse: "A", hausnummer: "1", plz: "60311", stadtteil: "Mitte", stadt: "Frankfurt" },
    schulform: null,
    inactive_since: null,
    memberships: [{ saison_id: SAISON, gruppe: "A", austritt: null, trikot_farbe: null, kontakte: kontakte }],
  }) as unknown as FLTeamWithMemberships;

const seats = (): FLSaisonTeamKontakte => ({
  trainer: person("Tim"),
  ansprechperson: person("Erika"),
  stellvertretung: null,
  trainer_ist_zugleich: null,
});

const ROWS = buildKontaktRows([club("gezielt", "Goethe", seats()), club("daneben", "Helmholtz", seats())], SAISON);
const FACETS = buildKontakteFacets(ROWS.map((row) => ({ teamId: row.teamId, name: row.teamName })));

/** The row link's own template, so what is decoded below is the URL the table builds rather than a copy. */
const HREF_TEMPLATE = /href=\{withSaisonId\(`(\/admin\/kontakte\?[^`]*)`/.exec(TABLE)?.[1] ?? "";

// Composed by the SHIPPING helper rather than by a hand-filled `${saisonParam}`: what has to hold
// is that the season lands in the query, not how the table spells the join.
const HREF = withSaisonId(HREF_TEMPLATE.replace("${team.id}", "gezielt"), SAISON);

const query = (href: string): URLSearchParams => new URLSearchParams(href.slice(href.indexOf("?") + 1));

describe("the contacts link the club list offers", () => {
  /* First: a template the cut no longer finds leaves every assertion below reading an empty string,
     and the filtering case would then pass over an unfiltered list. */
  it("builds a link into the contacts list at all", () => {
    assert.notEqual(HREF_TEMPLATE, "", "the club list offers no link into the contacts list");
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
    assert.match(TABLE, /href=\{withSaisonId\(`\/admin\/kontakte\?team=/, "the link no longer composes the season through the shared helper");
  });
});
