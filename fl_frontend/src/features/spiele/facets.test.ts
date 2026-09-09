import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { SCHIEDSRICHTER_ANONYM_LABEL } from "@/features/schiedsrichter/constants.ts";
import { applyFacets, readFacetSelection } from "@/shared/utils/facets.ts";

import { ANONYMISED_SCHIEDSRICHTER_VALUE, buildSpielFacets, schiedsrichterFacetValue } from "./facets.ts";

import type { FLSpiel, FLSpielTeamFieldJoined } from "./schemas.ts";

const TODAY = "2026-07-29";

const SPIELTAG_ZWEI = "6890a1b2c3d4e5f607182901";
const SPIELTAG_ZEHN = "6890a1b2c3d4e5f607182902";

const ALPHA = "6890a1b2c3d4e5f607182911";
const BETA = "6890a1b2c3d4e5f607182912";
const GAMMA = "6890a1b2c3d4e5f607182913";

const ANONYMISIERT_EINS = "6890a1b2c3d4e5f607182921";
const ANONYMISIERT_ZWEI = "6890a1b2c3d4e5f607182922";
const COLLINA = "6890a1b2c3d4e5f607182923";

function team(id: string, name: string, shorthand: string): FLSpielTeamFieldJoined {
  return { team_id: id, name: name, shorthand: shorthand, tore: null, austritt_type: null };
}

/** One complete fixture, of which a case varies only what the facet under test reads. */
function spiel(spielNr: number, over: Partial<FLSpiel> = {}): FLSpiel {
  return {
    id: `6890a1b2c3d4e5f60718300${String(spielNr)}`,
    spieltag_id: SPIELTAG_ZWEI,
    team1: team(ALPHA, "FC Alpha", "AL"),
    team2: team(BETA, "SV Beta", "BE"),
    team1_quelle: null,
    team2_quelle: null,
    datum: "2026-08-01",
    uhrzeit: "18:00",
    ort: { spielort_id: "6890a1b2c3d4e5f607182931", name: "Sportpark Nord", maps_link: "https://maps.example/nord" },
    schiedsrichter: null,
    ergebnis: null,
    elfmeterschiessen: null,
    spiel_nr: spielNr,
    sonderereignis: null,
    saison_phase: "gruppenphase",
    saison_id: "2526",
    notiz: null,
    ...over,
  };
}

/* The erasure nulls the embedded name; no fixture ever stores a word standing for it. */
const ANONYMISIERT_A = spiel(1, { schiedsrichter: { schiedsrichter_id: ANONYMISIERT_EINS, name: null } });
const ANONYMISIERT_B = spiel(2, { schiedsrichter: { schiedsrichter_id: ANONYMISIERT_ZWEI, name: null } });
const NAMED = spiel(3, { schiedsrichter: { schiedsrichter_id: COLLINA, name: "Pierluigi Collina" } });
const UNASSIGNED = spiel(4);

const SEASON: readonly FLSpiel[] = [ANONYMISIERT_A, ANONYMISIERT_B, NAMED, UNASSIGNED];

/** Handed in out of alphabetical order, which is the order the matchdays are played. */
const SPIELTAGE = [
  { id: SPIELTAG_ZWEI, label: "2. Spieltag" },
  { id: SPIELTAG_ZEHN, label: "10. Spieltag" },
];

const ADMIN_FACETS = buildSpielFacets({ spiele: SEASON, today: TODAY, isAdmin: true, spieltage: SPIELTAGE });

/** Spelled out so a rename fails here rather than silently. */
const SCHIEDSRICHTER_PARAM = "schiedsrichter";

const SCHIEDSRICHTER_FACET = ADMIN_FACETS.find((facet) => facet.param === SCHIEDSRICHTER_PARAM);
const MERGED_OPTION = SCHIEDSRICHTER_FACET?.options.find((option) => option.value === ANONYMISED_SCHIEDSRICHTER_VALUE);

describe("the referee facet an administrator is offered", () => {
  /* First: every assertion below asserts nothing where the cut finds no facet. */
  it("offers the referee as a facet at all", () => {
    assert.ok(SCHIEDSRICHTER_FACET, "no facet reads the referee parameter");
    assert.equal(SCHIEDSRICHTER_FACET.label, "Schiedsrichter");
  });

  it("offers one option for all the anonymised referees together", () => {
    const merged = SCHIEDSRICHTER_FACET?.options.filter((option) => option.value === ANONYMISED_SCHIEDSRICHTER_VALUE) ?? [];

    assert.equal(merged.length, 1, `${String(merged.length)} options merge the anonymised referees, which an administrator cannot tell apart`);
  });

  /* The option a reader picks says a word; the value the URL carries says none of it, so rewording
     the label leaves every saved link selecting the same fixtures. */
  it("labels that one option with the erasure's displayed word and keys it on neither a name nor an id", () => {
    assert.equal(MERGED_OPTION?.label, SCHIEDSRICHTER_ANONYM_LABEL);
    assert.notEqual(MERGED_OPTION?.value, SCHIEDSRICHTER_ANONYM_LABEL);
    assert.notEqual(MERGED_OPTION?.value, ANONYMISIERT_EINS);
  });

  it("narrows to the fixtures of every anonymised referee under that one option", () => {
    const selection = readFacetSelection(ADMIN_FACETS, new URLSearchParams(`${SCHIEDSRICHTER_PARAM}=${MERGED_OPTION?.value ?? ""}`));

    assert.deepEqual(applyFacets([...SEASON], ADMIN_FACETS, selection), [ANONYMISIERT_A, ANONYMISIERT_B]);
  });

  /* The referee table's „Einsätze anzeigen“ builds its link from a referee ROW, which the erasure
     leaves standing under its own id — so what that link carries has to reach the merged option. */
  it("resolves a link built from an anonymised referee's own id to every anonymised referee's fixtures", () => {
    const linked = schiedsrichterFacetValue({ id: ANONYMISIERT_EINS, name: null });
    const selection = readFacetSelection(ADMIN_FACETS, new URLSearchParams(`${SCHIEDSRICHTER_PARAM}=${linked}`));

    assert.deepEqual(applyFacets([...SEASON], ADMIN_FACETS, selection), [ANONYMISIERT_A, ANONYMISIERT_B]);
  });

  // Paired with the case above, which a value merging everybody would also satisfy.
  it("leaves a named referee's link on their own id", () => {
    assert.equal(schiedsrichterFacetValue({ id: COLLINA, name: "Pierluigi Collina" }), COLLINA);
  });

  it("keeps a named referee on an option of their own", () => {
    const selection = readFacetSelection(ADMIN_FACETS, new URLSearchParams(`${SCHIEDSRICHTER_PARAM}=${COLLINA}`));

    assert.deepEqual(applyFacets([...SEASON], ADMIN_FACETS, selection), [NAMED]);
  });

  it("files a fixture with no referee under no option, rather than under the merged one", () => {
    assert.deepEqual(SCHIEDSRICHTER_FACET?.read(UNASSIGNED), []);
  });
});

describe("the facets a fixture list is narrowed by", () => {
  /* Spelled out whole: what this catches is an admin-only facet reaching the list a visitor reads,
     which is the referee's today and another one tomorrow. */
  it("offers a visitor no referee facet", () => {
    assert.deepEqual(
      buildSpielFacets({ spiele: SEASON, today: TODAY, isAdmin: false, spieltage: SPIELTAGE }).map((facet) => facet.param),
      ["status", "phase", "spieltag", "team", "ort"],
    );
  });

  /* `section` beside the two `Facet.param` names: the action-required strip spends it, and
     `fl_frontend/src/shared/utils/facets.test.ts` holds every discovered slice to the same three. */
  it("gives every facet a parameter of its own, and none another control already spends", () => {
    const params = ADMIN_FACETS.map((facet) => facet.param);
    const claimed = params.filter((param) => ["q", "saison_id", "section"].includes(param));

    assert.equal(new Set(params).size, params.length, `two facets share a parameter: ${params.join(", ")}`);
    assert.deepEqual(claimed, [], `a facet claims a parameter another control spends: ${claimed.join(", ")}`);
  });

  it("finds a club whichever side of the fixture it played on", () => {
    const heim = spiel(5, { team1: team(GAMMA, "TSV Gamma", "GA"), team2: team(ALPHA, "FC Alpha", "AL") });
    const auswaerts = spiel(6, { team1: team(ALPHA, "FC Alpha", "AL"), team2: team(GAMMA, "TSV Gamma", "GA") });
    const facets = buildSpielFacets({ spiele: [heim, auswaerts], today: TODAY, isAdmin: true });
    const selection = readFacetSelection(facets, new URLSearchParams(`team=${GAMMA}`));

    assert.equal(facets.find((facet) => facet.param === "team")?.options.length, 2, "a club playing both sides is offered twice");
    assert.deepEqual(applyFacets([heim, auswaerts], facets, selection), [heim, auswaerts]);
  });

  it("answers with every gap a fixture has, and `vollstaendig` only where it has none", () => {
    const ansetzung = ADMIN_FACETS.find((facet) => facet.param === "ansetzung");
    const bare = spiel(7, { datum: null, uhrzeit: null, ort: null });

    assert.deepEqual(ansetzung?.read(bare), ["kein_datum", "keine_uhrzeit", "kein_ort", "kein_schiedsrichter"]);
    assert.deepEqual(ansetzung?.read(NAMED), ["vollstaendig"]);
  });

  it("counts a cancelled fixture that carries a result as scored", () => {
    const ergebnis = ADMIN_FACETS.find((facet) => facet.param === "ergebnis");
    const forfeit = spiel(8, { sonderereignis: "nichtantreten_team1", ergebnis: "3:0" });

    assert.deepEqual(ergebnis?.read(forfeit), ["gewertet"]);
    assert.deepEqual(ergebnis?.read(UNASSIGNED), ["offen"]);
  });

  it("offers the matchdays in the order they are played rather than by name", () => {
    assert.deepEqual(
      ADMIN_FACETS.find((facet) => facet.param === "spieltag")?.options.map((option) => option.label),
      ["2. Spieltag", "10. Spieltag"],
    );
  });

  it("declares no matchday facet where the page fetched none", () => {
    const facets = buildSpielFacets({ spiele: SEASON, today: TODAY, isAdmin: true });

    assert.ok(!facets.some((facet) => facet.param === "spieltag"), "a matchday facet is offered with nothing in it");
  });
});
