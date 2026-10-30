import { side as sharedSide, spielFields } from "@/test-support/fixtures.ts";
import { describe, expect, it } from "vitest";

import { buildReplacementContext, describePlatz, describeUebernommeneSpiele } from "./replacementOffer.ts";

import type { FLSpiel } from "../../../../spiele/types.ts";
import type { FLAustritt } from "../../../../teams/schemas.ts";

/**
 * A fixture with neither side filled, each case supplying the clubs it is about. Deliberately not a
 * shape the draw writes: `buildReplacementContext` reads no phase and no provenance, so one would
 * suggest it grades something it does not.
 */
const BLANK: FLSpiel = spielFields({ id: "0".repeat(24), spieltag_id: "1".repeat(24), team1: null, team2: null });

/** The shared side, named per case, with the club's exit where the case gives one. */
const side = (teamId: string, name: string, austrittType: FLAustritt["type"] | null = null): FLSpiel["team1"] => ({
  ...sharedSide(teamId, { name, shorthand: name.slice(0, 2).toUpperCase() }),
  austritt_type: austrittType,
});

const spiel = (fields: Partial<FLSpiel> = {}): FLSpiel => ({ ...BLANK, ...fields });

const AUSTRITT: FLAustritt = { type: "rueckzug", grund: "Kein Kader", datum: "2026-03-12" };

const ALT = "a".repeat(24);
const ARRIVING = "b".repeat(24);
const LEAVING = "c".repeat(24);

const clubRow = (id: string, name: string, austritt: FLAustritt | null = null) => ({ id, name, gruppe: "A" as const, austritt });

const contextOf = (fields: Partial<Parameters<typeof buildReplacementContext>[0]> = {}) =>
  buildReplacementContext({ saisonId: "2026", teams: [], ligaTeams: [], gruppenSpiele: [], playoffSpiele: [], ...fields });

describe("buildReplacementContext", () => {
  /* `REQ-REPLACE-002` reads every phase, unlike `REQ-SWAP-004`. Narrow this to the group phase and a
     club whose only played fixture is a bracket tie is offered, and the endpoint 409s on the press. */
  it("counts a played fixture from either half of the season", () => {
    const played = spiel({ team1: side(ALT, "SV Alt"), ergebnis: "3:1" });

    expect(contextOf({ teams: [clubRow(ALT, "SV Alt")], gruppenSpiele: [played] }).rows[0]?.gespielteSpiele).toBe(1);
    expect(contextOf({ teams: [clubRow(ALT, "SV Alt")], playoffSpiele: [played] }).rows[0]?.gespielteSpiele).toBe(1);
  });

  /* Mirrors the shoot-out clause of `has_taken_place`: stored beside no result it is a hand-written
     record of a decided tie, and the row it stands on must read "hat schon gespielt" — the endpoint
     409s the handover with `REQ-REPLACE-002`. */
  it("counts a fixture holding only a shoot-out as played", () => {
    const decided = spiel({ team1: side(ALT, "SV Alt"), elfmeterschiessen: { team1: 5, team2: 4 } });

    expect(contextOf({ teams: [clubRow(ALT, "SV Alt")], playoffSpiele: [decided] }).rows[0]?.gespielteSpiele).toBe(1);
  });

  /* Two figures over one list, and the panel says both: how many fixtures move, and whether any of
     them closes the offer. Derive one from the other and a season mid-play reads as untouched. */
  it("separates the fixtures a row holds from the ones it has played", () => {
    const rows = contextOf({
      teams: [clubRow(ALT, "SV Alt")],
      gruppenSpiele: [
        spiel({ team1: side(ALT, "SV Alt"), ergebnis: "2:0" }),
        spiel({ team2: side(ALT, "SV Alt") }),
        spiel({ team1: side(ALT, "SV Alt") }),
      ],
    }).rows;

    expect(rows[0]?.spiele).toBe(3);
    expect(rows[0]?.gespielteSpiele).toBe(1);
  });

  /* The endpoint reports its fan-out per document, so counting a club once per SIDE would promise
     one more fixture than the write moves — and `REQ-REPLACE-002` would be graded on that figure. */
  it("counts a fixture holding one club on both sides once", () => {
    const rows = contextOf({
      teams: [clubRow(ALT, "SV Alt")],
      gruppenSpiele: [spiel({ team1: side(ALT, "SV Alt"), team2: side(ALT, "SV Alt"), ergebnis: "1:1" })],
    }).rows;

    expect(rows[0]?.spiele).toBe(1);
    expect(rows[0]?.gespielteSpiele).toBe(1);
  });

  /* The case the operation exists for: every club read starts at the `teams` collection, so a
     junction row whose club is gone reaches none of them. Drop this and the row cannot be repaired. */
  it("offers a junction row no club read reaches, off its fixtures alone", () => {
    const rows = contextOf({
      teams: [clubRow(ALT, "SV Alt")],
      gruppenSpiele: [spiel({ team1: side(ALT, "SV Alt"), team2: side(LEAVING, "FC Verschwunden") })],
    }).rows;

    const orphaned = rows.find((row) => row.teamId === LEAVING);

    expect(orphaned?.name).toBe("FC Verschwunden");
    expect(orphaned?.isVerwaist).toBe(true);
    // The group is stored on the row and served by no read this page makes, so the panel shows none.
    expect(orphaned?.gruppe).toBe(null);
    expect(orphaned?.spiele).toBe(1);
    expect(rows.find((row) => row.teamId === ALT)?.isVerwaist).toBe(false);
  });

  /* A season entered but not yet drawn holds no fixture at all, and its rows are exactly the ones a
     replacement is cheapest on. Read the rows off the fixtures alone and every one of them vanishes. */
  it("offers a club that holds no fixture yet", () => {
    const rows = contextOf({ teams: [clubRow(ALT, "SV Alt")] }).rows;

    expect(rows.map((row) => [row.teamId, row.spiele, row.gespielteSpiele])).toStrictEqual([[ALT, 0, 0]]);
  });

  /* Two sources for one fact, because neither reaches both cases: the club read holds the row itself,
     and a row with no club is only ever seen through the `austritt_type` a fixture joins onto it. */
  it("takes the austritt off the club row, and off a fixture where there is no club row", () => {
    const rows = contextOf({
      teams: [clubRow(ALT, "SV Alt", AUSTRITT), clubRow(ARRIVING, "SV Neu")],
      gruppenSpiele: [spiel({ team1: side(LEAVING, "FC Verschwunden", "disqualifikation"), team2: side(ARRIVING, "SV Neu") })],
    }).rows;

    expect(rows.find((row) => row.teamId === ALT)?.hasAustritt).toBe(true);
    expect(rows.find((row) => row.teamId === LEAVING)?.hasAustritt).toBe(true);
    expect(rows.find((row) => row.teamId === ARRIVING)?.hasAustritt).toBe(false);
  });

  /* `REQ-REPLACE-003` and `REQ-ENTER-005`, graded before the press. The first arm is also what keeps
     one club off both ends: the outgoing club holds a row in this season too. */
  it("marks a candidate already in the season and one that left the league", () => {
    const { candidates } = contextOf({
      ligaTeams: [
        { id: ALT, name: "SV Alt", inactive_since: null, memberships: [{ saison_id: "2026" }] },
        { id: ARRIVING, name: "SV Neu", inactive_since: null, memberships: [{ saison_id: "2025" }] },
        { id: LEAVING, name: "SV Still", inactive_since: "2025-06-01", memberships: [] },
      ],
    });

    expect(candidates.map((candidate) => [candidate.id, candidate.isInSaison, candidate.isStillgelegt])).toStrictEqual([
      [ALT, true, false],
      [ARRIVING, false, false],
      [LEAVING, false, true],
    ]);
  });

  /* The rows with a club come from a read sorted by name and the others are appended after them, so
     without the sort every repairable row sits below the alphabet rather than inside it. */
  it("orders the rows by name, the appended ones included", () => {
    const rows = contextOf({
      teams: [clubRow(ALT, "Zeta SV")],
      gruppenSpiele: [spiel({ team1: side(LEAVING, "Alpha SV") })],
    }).rows;

    expect(rows.map((row) => row.name)).toStrictEqual(["Alpha SV", "Zeta SV"]);
  });
});

describe("describeUebernommeneSpiele", () => {
  /* Zero is a sentence rather than silence: a season drawn later hands the arriving club every
     fixture that draw produces, so "none yet" is the true answer and not the absence of one. */
  it("answers at zero, at one and above", () => {
    expect(describeUebernommeneSpiele(0)).toMatch(/noch keine/);
    expect(describeUebernommeneSpiele(1)).toMatch(/^Das eine angesetzte Spiel/);
    expect(describeUebernommeneSpiele(4)).toMatch(/^Alle 4 angesetzten Spiele/);
  });

  /* The draw deletes what it replaces and says so; this write deletes nothing, so that register would ask an admin
     to agree to a loss that will not happen. */
  it("promises the fixtures move with the place, in no word of the draw's losses", () => {
    expect(describeUebernommeneSpiele(1)).toMatch(/wechselt mit/);
    expect(describeUebernommeneSpiele(4)).toMatch(/wechseln mit/);
    for (const spiele of [0, 1, 4]) expect(describeUebernommeneSpiele(spiele)).not.toMatch(/verloren|gelöscht|entfäll|verschoben/);
  });
});

describe("describePlatz", () => {
  /* A row with no club document has no group to name, and `Gruppe null` is what an unguarded
     template renders there. */
  it("names the group, and the season where there is none to name", () => {
    expect(describePlatz("B")).toBe("in Gruppe B");
    expect(describePlatz(null)).toBe("in dieser Saison");
  });
});
