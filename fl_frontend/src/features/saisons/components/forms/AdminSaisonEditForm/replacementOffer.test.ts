import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildReplacementContext, describePlatz, describeUebernommeneSpiele } from "./replacementOffer.ts";

import type { FLSpiel } from "../../../../spiele/schemas.ts";
import type { FLAustritt } from "../../../../teams/schemas.ts";

/**
 * A fixture with neither side filled, each case supplying the clubs it is about. Deliberately not a
 * shape the draw writes: `buildReplacementContext` reads no phase and no provenance, so one would
 * suggest it grades something it does not.
 */
const LEER: FLSpiel = {
  id: "0".repeat(24),
  spieltag_id: "1".repeat(24),
  team1: null,
  team2: null,
  team1_quelle: null,
  team2_quelle: null,
  datum: null,
  uhrzeit: null,
  ort: null,
  schiedsrichter: null,
  ergebnis: null,
  elfmeterschiessen: null,
  spiel_nr: 1,
  sonderereignis: null,
  saison_phase: "gruppenphase",
  saison_id: "2026",
  notiz: null,
};

const seite = (teamId: string, name: string, austrittType: FLAustritt["type"] | null = null): FLSpiel["team1"] => ({
  team_id: teamId,
  tore: null,
  name,
  shorthand: name.slice(0, 2).toUpperCase(),
  austritt_type: austrittType,
});

const spiel = (fields: Partial<FLSpiel> = {}): FLSpiel => ({ ...LEER, ...fields });

const AUSTRITT: FLAustritt = { type: "rueckzug", grund: "Kein Kader", datum: "2026-03-12" };

const ALT = "a".repeat(24);
const NEU = "b".repeat(24);
const WEG = "c".repeat(24);

const clubRow = (id: string, name: string, austritt: FLAustritt | null = null) => ({ id, name, gruppe: "A" as const, austritt });

const contextOf = (fields: Partial<Parameters<typeof buildReplacementContext>[0]> = {}) =>
  buildReplacementContext({ saisonId: "2026", teams: [], ligaTeams: [], gruppenSpiele: [], playoffSpiele: [], ...fields });

describe("buildReplacementContext", () => {
  /* `REQ-REPLACE-002` reads every phase, unlike `REQ-SWAP-004`. Narrow this to the group phase and a
     club whose only played fixture is a bracket tie is offered, and the endpoint 409s on the press. */
  it("counts a played fixture from either half of the season", () => {
    const played = spiel({ team1: seite(ALT, "SV Alt"), ergebnis: "3:1" });

    assert.equal(contextOf({ teams: [clubRow(ALT, "SV Alt")], gruppenSpiele: [played] }).rows[0]?.gespielteSpiele, 1);
    assert.equal(contextOf({ teams: [clubRow(ALT, "SV Alt")], playoffSpiele: [played] }).rows[0]?.gespielteSpiele, 1);
  });

  /* Mirrors the shoot-out clause of `has_taken_place`: stored beside no result it is a hand-written
     record of a decided tie, and the row it stands on must read "hat schon gespielt" — the endpoint
     409s the handover with `REQ-REPLACE-002`. */
  it("counts a fixture holding only a shoot-out as played", () => {
    const decided = spiel({ team1: seite(ALT, "SV Alt"), elfmeterschiessen: { team1: 5, team2: 4 } });

    assert.equal(contextOf({ teams: [clubRow(ALT, "SV Alt")], playoffSpiele: [decided] }).rows[0]?.gespielteSpiele, 1);
  });

  /* Two figures over one list, and the panel says both: how many fixtures move, and whether any of
     them closes the offer. Derive one from the other and a season mid-play reads as untouched. */
  it("separates the fixtures a row holds from the ones it has played", () => {
    const rows = contextOf({
      teams: [clubRow(ALT, "SV Alt")],
      gruppenSpiele: [
        spiel({ team1: seite(ALT, "SV Alt"), ergebnis: "2:0" }),
        spiel({ team2: seite(ALT, "SV Alt") }),
        spiel({ team1: seite(ALT, "SV Alt") }),
      ],
    }).rows;

    assert.equal(rows[0]?.spiele, 3);
    assert.equal(rows[0]?.gespielteSpiele, 1);
  });

  /* The endpoint reports its fan-out per document, so counting a club once per SIDE would promise
     one more fixture than the write moves — and `REQ-REPLACE-002` would be graded on that figure. */
  it("counts a fixture holding one club on both sides once", () => {
    const rows = contextOf({
      teams: [clubRow(ALT, "SV Alt")],
      gruppenSpiele: [spiel({ team1: seite(ALT, "SV Alt"), team2: seite(ALT, "SV Alt"), ergebnis: "1:1" })],
    }).rows;

    assert.equal(rows[0]?.spiele, 1);
    assert.equal(rows[0]?.gespielteSpiele, 1);
  });

  /* The case the operation exists for: every club read starts at the `teams` collection, so a
     junction row whose club is gone reaches none of them. Drop this and the row cannot be repaired. */
  it("offers a junction row no club read reaches, off its fixtures alone", () => {
    const rows = contextOf({
      teams: [clubRow(ALT, "SV Alt")],
      gruppenSpiele: [spiel({ team1: seite(ALT, "SV Alt"), team2: seite(WEG, "FC Verschwunden") })],
    }).rows;

    const verwaist = rows.find((row) => row.teamId === WEG);

    assert.equal(verwaist?.name, "FC Verschwunden");
    assert.equal(verwaist?.isVerwaist, true);
    // The group is stored on the row and served by no read this page makes, so the panel shows none.
    assert.equal(verwaist?.gruppe, null);
    assert.equal(verwaist?.spiele, 1);
    assert.equal(rows.find((row) => row.teamId === ALT)?.isVerwaist, false);
  });

  /* A season entered but not yet drawn holds no fixture at all, and its rows are exactly the ones a
     replacement is cheapest on. Read the rows off the fixtures alone and every one of them vanishes. */
  it("offers a club that holds no fixture yet", () => {
    const rows = contextOf({ teams: [clubRow(ALT, "SV Alt")] }).rows;

    assert.deepEqual(
      rows.map((row) => [row.teamId, row.spiele, row.gespielteSpiele]),
      [[ALT, 0, 0]],
    );
  });

  /* Two sources for one fact, because neither reaches both cases: the club read holds the row itself,
     and a row with no club is only ever seen through the `austritt_type` a fixture joins onto it. */
  it("takes the austritt off the club row, and off a fixture where there is no club row", () => {
    const rows = contextOf({
      teams: [clubRow(ALT, "SV Alt", AUSTRITT), clubRow(NEU, "SV Neu")],
      gruppenSpiele: [spiel({ team1: seite(WEG, "FC Verschwunden", "disqualifikation"), team2: seite(NEU, "SV Neu") })],
    }).rows;

    assert.equal(rows.find((row) => row.teamId === ALT)?.hasAustritt, true);
    assert.equal(rows.find((row) => row.teamId === WEG)?.hasAustritt, true);
    assert.equal(rows.find((row) => row.teamId === NEU)?.hasAustritt, false);
  });

  /* `REQ-REPLACE-003` and `REQ-ENTER-005`, graded before the press. The first arm is also what keeps
     one club off both ends: the outgoing club holds a row in this season too. */
  it("marks a candidate already in the season and one that left the league", () => {
    const { candidates } = contextOf({
      ligaTeams: [
        { id: ALT, name: "SV Alt", inactive_since: null, memberships: [{ saison_id: "2026" }] },
        { id: NEU, name: "SV Neu", inactive_since: null, memberships: [{ saison_id: "2025" }] },
        { id: WEG, name: "SV Still", inactive_since: "2025-06-01", memberships: [] },
      ],
    });

    assert.deepEqual(
      candidates.map((candidate) => [candidate.id, candidate.isInSaison, candidate.isStillgelegt]),
      [
        [ALT, true, false],
        [NEU, false, false],
        [WEG, false, true],
      ],
    );
  });

  /* The rows with a club come from a read sorted by name and the others are appended after them, so
     without the sort every repairable row sits below the alphabet rather than inside it. */
  it("orders the rows by name, the appended ones included", () => {
    const rows = contextOf({
      teams: [clubRow(ALT, "Zeta SV")],
      gruppenSpiele: [spiel({ team1: seite(WEG, "Alpha SV") })],
    }).rows;

    assert.deepEqual(
      rows.map((row) => row.name),
      ["Alpha SV", "Zeta SV"],
    );
  });
});

describe("describeUebernommeneSpiele", () => {
  /* Zero is a sentence rather than silence: a season drawn later hands the arriving club every
     fixture that draw produces, so "none yet" is the true answer and not the absence of one. */
  it("answers at zero, at one and above", () => {
    assert.match(describeUebernommeneSpiele(0), /noch keine/);
    assert.match(describeUebernommeneSpiele(1), /^Das eine angesetzte Spiel/);
    assert.match(describeUebernommeneSpiele(4), /^Alle 4 angesetzten Spiele/);
  });
});

describe("describePlatz", () => {
  /* A row with no club document has no group to name, and `Gruppe null` is what an unguarded
     template renders there. */
  it("names the group, and the season where there is none to name", () => {
    assert.equal(describePlatz("B"), "in Gruppe B");
    assert.equal(describePlatz(null), "in dieser Saison");
  });
});
