import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { GHOST_SCHIEDSRICHTER_ID, SCHIEDSRICHTER_ANONYM_LABEL, SCHIEDSRICHTER_OHNE_NAMEN_LABEL } from "@/features/schiedsrichter/constants.ts";
import { applyFacets, offeredOptions, readFacetSelection } from "@/shared/utils/facets.ts";

import { buildSpielFacets } from "./facets.ts";

import type { FLSpiel, FLSpielTeamFieldJoined } from "./schemas.ts";

const TODAY = "2026-07-29";

const SPIELTAG_ZWEI = "6890a1b2c3d4e5f607182901";
const SPIELTAG_ZEHN = "6890a1b2c3d4e5f607182902";

const ALPHA = "6890a1b2c3d4e5f607182911";
const BETA = "6890a1b2c3d4e5f607182912";
const GAMMA = "6890a1b2c3d4e5f607182913";

/** The row every erased referee's fixtures are repointed at; no season's referee list ever holds it. */
const GHOST = GHOST_SCHIEDSRICHTER_ID;
/** A row somebody left without a name, which is a different thing and keeps its own fixtures. */
const NAMENLOS = "6890a1b2c3d4e5f607182922";
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

/* Two erased referees' fixtures arrive under ONE id, the erasure having repointed both at the ghost;
   the embedded name is null on each, no fixture ever storing a word standing for it. */
const GHOSTED_A = spiel(1, { schiedsrichter: { schiedsrichter_id: GHOST, name: null } });
const GHOSTED_B = spiel(2, { schiedsrichter: { schiedsrichter_id: GHOST, name: null } });
const NAMED = spiel(3, { schiedsrichter: { schiedsrichter_id: COLLINA, name: "Pierluigi Collina" } });
const NAMELESS = spiel(5, { schiedsrichter: { schiedsrichter_id: NAMENLOS, name: null } });
const UNASSIGNED = spiel(4);

const SEASON: readonly FLSpiel[] = [GHOSTED_A, GHOSTED_B, NAMED, NAMELESS, UNASSIGNED];

/** Handed in out of alphabetical order, which is the order the matchdays are played. */
const SPIELTAGE = [
  { id: SPIELTAG_ZWEI, label: "2. Spieltag" },
  { id: SPIELTAG_ZEHN, label: "10. Spieltag" },
];

const ADMIN_FACETS = buildSpielFacets({ spiele: SEASON, today: TODAY, isAdmin: true, spieltage: SPIELTAGE });

/** Spelled out so a rename fails here rather than silently. */
const SCHIEDSRICHTER_PARAM = "schiedsrichter";

const SCHIEDSRICHTER_FACET = ADMIN_FACETS.find((facet) => facet.param === SCHIEDSRICHTER_PARAM);
const GHOST_OPTION = SCHIEDSRICHTER_FACET?.options.find((option) => option.value === GHOST);

describe("the referee facet an administrator is offered", () => {
  /* First: every assertion below asserts nothing where the cut finds no facet. */
  it("offers the referee as a facet at all", () => {
    assert.ok(SCHIEDSRICHTER_FACET, "no facet reads the referee parameter");
    assert.equal(SCHIEDSRICHTER_FACET.label, "Schiedsrichter");
  });

  /* Not a merge this reader performs: the erasure repointed both fixtures at one row, so one option
     is what the season's own data already say. */
  it("offers one option for every erased referee's fixtures together", () => {
    const ghosted = SCHIEDSRICHTER_FACET?.options.filter((option) => option.value === GHOST) ?? [];

    assert.equal(ghosted.length, 1, `${String(ghosted.length)} options stand for the ghost, which an administrator cannot tell apart`);
  });

  /* Two different absences, and one word for both would file a teacher's unfinished entry under a
     deletion that never touched them. */
  it("words the ghost as the erasure's own and a nameless row as an unfinished entry", () => {
    assert.equal(GHOST_OPTION?.label, SCHIEDSRICHTER_ANONYM_LABEL);
    assert.equal(SCHIEDSRICHTER_FACET?.options.find((option) => option.value === NAMENLOS)?.label, SCHIEDSRICHTER_OHNE_NAMEN_LABEL);
  });

  it("narrows to the fixtures of every erased referee under that one option", () => {
    const selection = readFacetSelection(ADMIN_FACETS, new URLSearchParams(`${SCHIEDSRICHTER_PARAM}=${GHOST}`));

    assert.deepEqual(applyFacets([...SEASON], ADMIN_FACETS, selection), [GHOSTED_A, GHOSTED_B]);
  });

  // Paired with the case above, which one option over every nameless row would also satisfy.
  it("keeps a nameless row's own fixtures off the ghost's option", () => {
    const selection = readFacetSelection(ADMIN_FACETS, new URLSearchParams(`${SCHIEDSRICHTER_PARAM}=${NAMENLOS}`));

    assert.deepEqual(applyFacets([...SEASON], ADMIN_FACETS, selection), [NAMELESS]);
  });

  it("keeps a named referee on an option of their own", () => {
    const selection = readFacetSelection(ADMIN_FACETS, new URLSearchParams(`${SCHIEDSRICHTER_PARAM}=${COLLINA}`));

    assert.deepEqual(applyFacets([...SEASON], ADMIN_FACETS, selection), [NAMED]);
  });

  it("files a fixture with no referee under no option, rather than under the ghost's", () => {
    assert.deepEqual(SCHIEDSRICHTER_FACET?.read(UNASSIGNED), []);
  });

  /* The referee list links each row on its own id, so a season whose fixtures name a referee the
     list holds still offers that row — and the ghost, which no list holds, is not added by it. */
  it("offers a listed referee no fixture of the season names, and never the ghost", () => {
    const facets = buildSpielFacets({
      spiele: [NAMED],
      today: TODAY,
      isAdmin: true,
      schiedsrichter: [
        { id: NAMENLOS, name: null },
        { id: COLLINA, name: "Pierluigi Collina" },
      ],
    });
    const facet = facets.find((candidate) => candidate.param === SCHIEDSRICHTER_PARAM) ?? assert.fail("the season offers no referee facet");
    const selection = readFacetSelection(facets, new URLSearchParams(`${SCHIEDSRICHTER_PARAM}=${NAMENLOS}`));

    assert.deepEqual(selection, { [SCHIEDSRICHTER_PARAM]: [NAMENLOS] });
    assert.deepEqual(
      offeredOptions(facet, selection[SCHIEDSRICHTER_PARAM] ?? []).filter((option) => option.value === NAMENLOS),
      [{ value: NAMENLOS, label: SCHIEDSRICHTER_OHNE_NAMEN_LABEL }],
    );
    assert.ok(
      offeredOptions(facet, selection[SCHIEDSRICHTER_PARAM] ?? []).every((option) => option.value !== GHOST),
      "the ghost is offered on a season whose fixtures never name it",
    );
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
