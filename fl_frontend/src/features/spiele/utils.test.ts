import assert from "node:assert/strict";
import { describe, it } from "node:test";

// Relative import, not the "@/" alias: Node's resolver does not read tsconfig paths.
import {
  adminSpielEditHref,
  buildUndoPayloads,
  collectSpieltagTeamOccupancy,
  collectUsedQuelleKeys,
  computeErgebnisFor,
  computeSpielStatus,
  deriveSlotHerkunft,
  formatBracketFault,
  formatElfmeterschiessen,
  formatQuelle,
  formatSpielDisplay,
  formatSpielUpdateMessage,
  groupBracketFaultsBySpielId,
  listDependentSpiele,
  listFeederSpiele,
  quelleKey,
  spielStateKey,
  toPatchPayload,
} from "./utils.ts";

import type { FLBracketFault, FLSpiel, FLSpielAdvancement } from "./schemas.ts";

const TODAY = "2026-07-29";

const TEAM_1 = "6890a1b2c3d4e5f607182932";
const TEAM_2 = "6890a1b2c3d4e5f607182933";

function makeSpiel(ergebnis: string | null): FLSpiel {
  return {
    team1: { team_id: TEAM_1, name: "Team A", tore: null, shorthand: "TA" },
    team2: { team_id: TEAM_2, name: "Team B", tore: null, shorthand: "TB" },
    ergebnis,
  } as FLSpiel;
}

describe("computeSpielStatus", () => {
  it("returns 'abgesagt' regardless of date", () => {
    assert.equal(computeSpielStatus({ datum: "2020-01-01", isCanceled: true, today: TODAY }), "abgesagt");
    assert.equal(computeSpielStatus({ datum: "2099-01-01", isCanceled: true, today: TODAY }), "abgesagt");
  });

  // isCanceled must win over a null date, or a cancelled undated match reads as merely unknown.
  it("prefers 'abgesagt' over 'unbekannt' when the date is null", () => {
    assert.equal(computeSpielStatus({ datum: null, isCanceled: true, today: TODAY }), "abgesagt");
  });

  it("returns 'unbekannt' for a null date", () => {
    assert.equal(computeSpielStatus({ datum: null, isCanceled: false, today: TODAY }), "unbekannt");
  });

  it("returns 'ausstehend' for a future date", () => {
    assert.equal(computeSpielStatus({ datum: "2026-07-30", isCanceled: false, today: TODAY }), "ausstehend");
  });

  it("returns 'heute' for today", () => {
    assert.equal(computeSpielStatus({ datum: TODAY, isCanceled: false, today: TODAY }), "heute");
  });

  it("returns 'vergangen' for a past date", () => {
    assert.equal(computeSpielStatus({ datum: "2026-07-28", isCanceled: false, today: TODAY }), "vergangen");
  });

  // Lexicographic on YYYY-MM-DD, so correct only while both operands are zero-padded.
  it("compares correctly across month and year boundaries", () => {
    assert.equal(computeSpielStatus({ datum: "2026-08-01", isCanceled: false, today: "2026-07-31" }), "ausstehend");
    assert.equal(computeSpielStatus({ datum: "2025-12-31", isCanceled: false, today: "2026-01-01" }), "vergangen");
  });
});

describe("computeErgebnisFor", () => {
  it("reads the result from the requesting team's side", () => {
    assert.equal(computeErgebnisFor({ spiel: makeSpiel("3:1"), teamId: TEAM_1 }), "W");
    assert.equal(computeErgebnisFor({ spiel: makeSpiel("3:1"), teamId: TEAM_2 }), "L");
  });

  it("is symmetric when the away team wins", () => {
    assert.equal(computeErgebnisFor({ spiel: makeSpiel("1:3"), teamId: TEAM_1 }), "L");
    assert.equal(computeErgebnisFor({ spiel: makeSpiel("1:3"), teamId: TEAM_2 }), "W");
  });

  it("reports a draw for both sides", () => {
    assert.equal(computeErgebnisFor({ spiel: makeSpiel("2:2"), teamId: TEAM_1 }), "D");
    assert.equal(computeErgebnisFor({ spiel: makeSpiel("2:2"), teamId: TEAM_2 }), "D");
  });

  it("handles a goalless draw", () => {
    assert.equal(computeErgebnisFor({ spiel: makeSpiel("0:0"), teamId: TEAM_1 }), "D");
  });

  it("returns '?' for an unplayed match", () => {
    assert.equal(computeErgebnisFor({ spiel: makeSpiel(null), teamId: TEAM_1 }), "?");
  });

  // A split with no length check makes every comparison false, so the else branch reports a loss
  // — for both teams at once.
  it("returns '?' for a malformed ergebnis instead of silently reporting a loss", () => {
    for (const malformed of ["3", "", ":", "3:", ":1", "1:2:3", "abc", "x:y"]) {
      assert.equal(computeErgebnisFor({ spiel: makeSpiel(malformed), teamId: TEAM_1 }), "?", `expected "?" for ${JSON.stringify(malformed)}`);
      assert.equal(computeErgebnisFor({ spiel: makeSpiel(malformed), teamId: TEAM_2 }), "?", `expected "?" for ${JSON.stringify(malformed)}`);
    }
  });

  // A two-way branch would score an absent team from team2's side, rendering a confident loss.
  it("returns '?' for a teamId that is neither side, rather than scoring it as a loss", () => {
    const unknown = "6890a1b2c3d4e5f607189999";

    assert.equal(computeErgebnisFor({ spiel: makeSpiel("3:1"), teamId: unknown }), "?");
    assert.equal(computeErgebnisFor({ spiel: makeSpiel("1:3"), teamId: unknown }), "?");
    assert.equal(computeErgebnisFor({ spiel: makeSpiel("2:2"), teamId: unknown }), "?");
  });

  // Guards the digit class: the wire format is ASCII, and Number("٢") is NaN.
  it("returns '?' for non-ASCII digits", () => {
    assert.equal(computeErgebnisFor({ spiel: makeSpiel("٢:١"), teamId: TEAM_1 }), "?");
  });

  // The optional chaining compiles either way, so only this pins an unresolved side to "?".
  it("returns '?' when the side being asked about has no occupant", () => {
    const halfDrawn = { ...makeSpiel("3:1"), team1: null } as unknown as FLSpiel;

    assert.equal(computeErgebnisFor({ spiel: halfDrawn, teamId: TEAM_1 }), "?");
    assert.equal(computeErgebnisFor({ spiel: halfDrawn, teamId: TEAM_2 }), "L");
  });

  it("returns '?' for every team when neither side has an occupant", () => {
    const undrawn = { ...makeSpiel("3:1"), team1: null, team2: null } as unknown as FLSpiel;

    assert.equal(computeErgebnisFor({ spiel: undrawn, teamId: TEAM_1 }), "?");
    assert.equal(computeErgebnisFor({ spiel: undrawn, teamId: TEAM_2 }), "?");
  });
});

describe("formatSpielDisplay", () => {
  const spiel = { datum: "2026-07-28", uhrzeit: "14:00", ergebnis: "3:1", elfmeterschiessen: null };

  it("derives all four display values", () => {
    assert.deepEqual(formatSpielDisplay(spiel), { datum: "28.07.2026", uhrzeit: "14:00", ergebnis: "3:1", elfmeterschiessen: null });
  });

  // The three cards share a screen in some flows, so a second spelling is drift no type catches.
  it("uses one result placeholder for an unplayed match", () => {
    assert.equal(formatSpielDisplay({ ...spiel, ergebnis: null }).ergebnis, "-:-");
  });

  it("uses the shared placeholders for a missing date and time", () => {
    assert.deepEqual(formatSpielDisplay({ datum: null, uhrzeit: null, ergebnis: null, elfmeterschiessen: null }), {
      datum: "TBD",
      uhrzeit: "--:--",
      ergebnis: "-:-",
      elfmeterschiessen: null,
    });
  });

  // The score stays the draw the Saisontabelle counts; the shoot-out arrives separately.
  it("keeps a shoot-out beside the score rather than inside it", () => {
    const settled = formatSpielDisplay({ ...spiel, ergebnis: "2:2", elfmeterschiessen: { team1: 4, team2: 3 } });

    assert.equal(settled.ergebnis, "2:2");
    assert.equal(settled.elfmeterschiessen, "4:3\u202Fi.\u202FE.");
  });
});

describe("formatElfmeterschiessen", () => {
  it("returns null for a match that was not settled on penalties, which is almost all of them", () => {
    assert.equal(formatElfmeterschiessen(null), null);
  });

  // Narrow no-break spaces, so the abbreviation and its score never break across two lines.
  it("writes the shoot-out the way German football abbreviates it", () => {
    assert.equal(formatElfmeterschiessen({ team1: 5, team2: 4 }), "5:4\u202Fi.\u202FE.");
  });

  it("names the scoreline in fixture order rather than winner first", () => {
    assert.equal(formatElfmeterschiessen({ team1: 2, team2: 4 }), "2:4\u202Fi.\u202FE.");
  });
});

describe("formatQuelle", () => {
  it("returns null for a slot with no source, so the caller falls through to its own placeholder", () => {
    assert.equal(formatQuelle(null), null);
  });

  it("names a match-fed slot by the match number, with the trailing period the bracket prints", () => {
    assert.equal(formatQuelle({ type: "spiel", spiel_nr: 25, ausgang: "sieger" }), "Sieger 25.");
  });

  it("distinguishes the losing side, which is how a third-place play-off is fed", () => {
    assert.equal(formatQuelle({ type: "spiel", spiel_nr: 29, ausgang: "verlierer" }), "Verlierer 29.");
  });

  // One form for the whole set, so two slots compare at a glance and the picker reads as the
  // cards do.
  it("reads every placing as an ordinal, first included", () => {
    assert.equal(formatQuelle({ type: "gruppe", gruppe: "A", platz: 1 }), "1. der Gruppe A");
    assert.equal(formatQuelle({ type: "gruppe", gruppe: "C", platz: 2 }), "2. der Gruppe C");
    assert.equal(formatQuelle({ type: "gruppe", gruppe: "B", platz: 4 }), "4. der Gruppe B");
  });

  // A source mid-edit drafts `NaN`, which every consumer printed as "Sieger NaN.".
  it("returns null while a match-fed slot's number is still unpicked", () => {
    assert.equal(formatQuelle({ type: "spiel", spiel_nr: NaN, ausgang: "sieger" }), null);
  });

  it("returns null while a group-fed slot's placing is still unpicked", () => {
    assert.equal(formatQuelle({ type: "gruppe", gruppe: "B", platz: NaN }), null);
  });
});

describe("deriveSlotHerkunft", () => {
  const team = { team_id: TEAM_1, name: "Team A", tore: null, shorthand: "TA" };
  const quelle = { type: "spiel", spiel_nr: 25, ausgang: "sieger" } as const;

  it("reads a slot with a source as the resolution's, whether or not the winner has arrived", () => {
    assert.equal(deriveSlotHerkunft(null, quelle), "quelle");
    assert.equal(deriveSlotHerkunft(team, quelle), "quelle");
  });

  it("reads an occupied slot with no source as the admin's own", () => {
    assert.equal(deriveSlotHerkunft(team, null), "manuell");
  });

  // The state both surfaces exist to surface: nothing fills this side, and no later result will.
  it("reads a slot with neither a team nor a source as maintained by nobody", () => {
    assert.equal(deriveSlotHerkunft(null, null), "offen");
  });

  // The precedence the write path enforces: flipped, a resolution-owned slot would read as manual
  // on both surfaces at once.
  it("takes the source over the occupant, because the source is what maintains the slot", () => {
    assert.equal(deriveSlotHerkunft(team, { type: "gruppe", gruppe: "A", platz: 1 }), "quelle");
  });
});

describe("formatSpielUpdateMessage", () => {
  /** A fixture that moved and lost nothing — the ordinary case. */
  const moved = (spielNr: number): FLSpielAdvancement => ({ spiel_nr: spielNr, voided_ergebnis: null, voided_elfmeterschiessen: null });

  /** A fixture whose stored scoreline the same save deleted. */
  const voided = (spielNr: number, ergebnis: string): FLSpielAdvancement => ({
    spiel_nr: spielNr,
    voided_ergebnis: ergebnis,
    voided_elfmeterschiessen: null,
  });

  it("says only that the match was saved when the bracket did not move", () => {
    assert.equal(formatSpielUpdateMessage([]), "Die Spieldaten wurden erfolgreich aktualisiert");
  });

  it("names one advanced fixture in the singular", () => {
    assert.equal(
      formatSpielUpdateMessage([moved(29)]),
      "Die Spieldaten wurden erfolgreich aktualisiert. Die Paarung in Spiel 29 wurde ebenfalls aktualisiert",
    );
  });

  it("joins several with und, as German does and a hand-rolled join would not", () => {
    assert.equal(
      formatSpielUpdateMessage([moved(29), moved(30), moved(31)]),
      "Die Spieldaten wurden erfolgreich aktualisiert. Die Paarungen in den Spielen 29, 30 und 31 wurden ebenfalls aktualisiert",
    );
  });

  it("reports an advancement and a bracket fault in the same message", () => {
    const message = formatSpielUpdateMessage([moved(30)], [gruppeFault("gruppe_too_small", "A", 5)]);

    assert.match(message, /Die Paarung in Spiel 30 wurde ebenfalls aktualisiert\. Spiel 25 verweist/);
  });

  it("says nothing about a deleted result when a slot merely filled", () => {
    // The half that makes the sentence below worth reading: a warning that always fires is not one.
    assert.doesNotMatch(formatSpielUpdateMessage([moved(29)]), /gelöscht/);
  });

  it("gives a destroyed scoreline its own sentence, naming the fixture", () => {
    assert.match(
      formatSpielUpdateMessage([voided(30, "2:0")]),
      /Die Paarung in Spiel 30 wurde ebenfalls aktualisiert\. Das eingetragene Ergebnis in Spiel 30 wurde dabei gelöscht/,
    );
  });

  it("names only the fixtures that actually lost a result", () => {
    const message = formatSpielUpdateMessage([moved(29), voided(30, "2:0"), voided(31, "1:1")]);

    assert.match(message, /Die eingetragenen Ergebnisse in den Spielen 30 und 31 wurden dabei gelöscht/);
  });

  it("names a team released from another fixture of the same Spieltag", () => {
    const message = formatSpielUpdateMessage(
      [],
      [],
      [{ spiel_nr: 12, side: "team1", team_name: "Adler", voided_ergebnis: null, voided_elfmeterschiessen: null }],
    );

    assert.match(message, /Adler wurde aus Spiel 12 entfernt, da beide am selben Spieltag stattfinden/);
  });

  it("names the result a release destroyed, where there was one", () => {
    const message = formatSpielUpdateMessage(
      [],
      [],
      [{ spiel_nr: 12, side: "team2", team_name: "Adler", voided_ergebnis: "3:1", voided_elfmeterschiessen: null }],
    );

    assert.match(message, /dessen Ergebnis 3:1 damit gelöscht wurde/);
  });
});

/** The id is read only as a key, so any valid one will do. */
function gruppeFault(reason: "gruppe_too_small" | "tie_unresolved", gruppe: "A" | "B", platz: number): FLBracketFault {
  return { reason, spiel_id: "6890a1b2c3d4e5f607180025", spiel_nr: 25, gruppe, platz };
}

describe("toPatchPayload and buildUndoPayloads", () => {
  const fixture = (spielNr: number, ergebnis: string | null): FLSpiel =>
    ({
      id: `6890a1b2c3d4e5f6071800${String(spielNr).padStart(2, "0")}`,
      spiel_nr: spielNr,
      is_canceled: false,
      team1: { team_id: TEAM_1, name: "Team A", tore: ergebnis === null ? null : Number(ergebnis.split(":")[0]), shorthand: "TA" },
      team2: { team_id: TEAM_2, name: "Team B", tore: ergebnis === null ? null : Number(ergebnis.split(":")[1]), shorthand: "TB" },
      team1_quelle: null,
      team2_quelle: null,
      elfmeterschiessen: null,
      datum: "2026-03-15",
      uhrzeit: "18:00:00",
      ort: null,
      schiedsrichter: null,
      ergebnis,
    }) as FLSpiel;

  it("carries every field the write path would otherwise overwrite with nothing", () => {
    // The payload is `$set` wholesale, so an omitted field is erased by the very request meant to
    // restore it. Asserted as a key set, because that is exactly the failure: a value nobody notices.
    assert.deepEqual(Object.keys(toPatchPayload(fixture(29, "2:0"))).sort(), [
      "datum",
      "elfmeterschiessen",
      "is_canceled",
      "notiz",
      "ort",
      "schiedsrichter",
      "spiel_id",
      "team1",
      "team1_quelle",
      "team2",
      "team2_quelle",
      "uhrzeit",
    ]);
  });

  it("keys a fixture by its stored values, not by its id alone", () => {
    // The regression this guards is the undo's: reopening the SAME fixture after its values changed
    // must remount the editor, or every field keeps what its `useState` initialiser was seeded with.
    const before = fixture(29, null);
    const after = { ...before, uhrzeit: "20:15:00" } as FLSpiel;

    assert.notEqual(spielStateKey(before), spielStateKey(after));
  });

  it("keys two readings of an unchanged fixture identically, so re-entry does not thrash", () => {
    assert.equal(spielStateKey(fixture(29, null)), spielStateKey(fixture(29, null)));
  });

  it("keys two fixtures apart even when every stored value matches", () => {
    // The id leads the key precisely so identical values cannot collapse two fixtures into one.
    assert.notEqual(spielStateKey(fixture(29, null)), spielStateKey(fixture(30, null)));
  });

  it("ignores a change to a field no draft atom holds", () => {
    // `ergebnis` is derived by the backend and is on no payload, so it cannot reset a form that never
    // showed it as editable state — the key is the draft's mirror, not the whole document.
    const played = { ...fixture(29, null), ergebnis: "2:0" } as FLSpiel;

    assert.equal(spielStateKey(fixture(29, null)), spielStateKey(played));
  });

  it("does not carry ergebnis, which the backend derives and refuses to accept", () => {
    assert.equal("ergebnis" in toPatchPayload(fixture(29, "2:0")), false);
  });

  it("does not carry a side's joined disqualifikation onto the write path", () => {
    // Structural typing accepts the joined side wherever the stored one is asked for, so nothing in
    // the toolchain sees this: only Zod's `strip` keeps the join off the wire, and Pydantic's
    // `extra="ignore"` keeps it out of the document.
    const joined = {
      ...fixture(29, "2:0"),
      team1: {
        team_id: TEAM_1,
        name: "Team A",
        tore: 2,
        shorthand: "TA",
        disqualifikation: { grund: "Nicht angetreten", datum: "2026-03-01" },
      },
    } as FLSpiel;

    assert.deepEqual(Object.keys(toPatchPayload(joined).team1 ?? {}).sort(), ["name", "shorthand", "team_id", "tore"]);
  });

  it("puts the edited fixture first, so the resolution runs before the results go back", () => {
    // The whole correctness argument: restoring a downstream result first would have the resolution
    // triggered by the edited fixture clear it again, and the undo would report a success it did not
    // achieve.
    const edited = fixture(25, "1:3");
    const later = fixture(30, "0:0");
    const semi = fixture(29, "2:0");
    // Deliberately not in bracket order: the season list's order must not decide the replay's.
    const season = [later, edited, semi];

    assert.deepEqual(
      buildUndoPayloads(edited, season, [29, 30]).map((payload) => payload.spiel_id),
      [edited.id, later.id, semi.id],
    );
  });

  it("restores only the fixtures the save actually reported", () => {
    const edited = fixture(25, "1:3");
    const semi = fixture(29, "2:0");
    const season = [edited, semi, fixture(30, "0:0")];

    assert.deepEqual(
      buildUndoPayloads(edited, season, [29]).map((payload) => payload.spiel_id),
      [edited.id, semi.id],
    );
  });

  it("never lists the edited fixture twice when the save also reported it", () => {
    const edited = fixture(25, "1:3");

    assert.deepEqual(
      buildUndoPayloads(edited, [edited], [25]).map((payload) => payload.spiel_id),
      [edited.id],
    );
  });
});

describe("formatBracketFault", () => {
  // Every reason gets a case: this is the only place either codebase turns a fault into words, and a
  // reason with no wording would render as nothing at all rather than as a visible gap.
  it("names a platz the group will never produce", () => {
    assert.equal(
      formatBracketFault(gruppeFault("gruppe_too_small", "A", 5)),
      "Spiel 25 verweist auf Platz 5 der Gruppe A, doch so weit reicht diese Gruppe nicht",
    );
  });

  it("says which fixture an unbreakable tie leaves open", () => {
    assert.equal(
      formatBracketFault(gruppeFault("tie_unresolved", "B", 2)),
      "Platz 2 der Gruppe B ist auch nach der Gruppenphase nicht zu entscheiden, daher bleibt Spiel 25 offen",
    );
  });

  it("names the number to correct when the source is a match the season does not have", () => {
    assert.equal(
      formatBracketFault({ reason: "spiel_missing", spiel_id: "6890a1b2c3d4e5f607180029", spiel_nr: 29, quelle_spiel_nr: 99 }),
      "Spiel 29 verweist auf Spiel 99, das es in dieser Saison nicht gibt",
    );
  });

  it("says a chain closes on itself rather than that a number is missing", () => {
    assert.equal(
      formatBracketFault({ reason: "reference_cycle", spiel_id: "6890a1b2c3d4e5f607180029", spiel_nr: 29, quelle_spiel_nr: 30 }),
      "Spiel 29 verweist über Spiel 30 auf eine Verweiskette, die sich schließt und kein Ergebnis liefern kann",
    );
  });

  it("names the fixture whose two sides lead to one club", () => {
    assert.equal(
      formatBracketFault({ reason: "same_team", spiel_id: "6890a1b2c3d4e5f607180029", spiel_nr: 29 }),
      "In Spiel 29 führen beide Seiten zur selben Mannschaft",
    );
  });
});

describe("groupBracketFaultsBySpielId", () => {
  const twentyNine = "6890a1b2c3d4e5f607180029";
  const thirty = "6890a1b2c3d4e5f607180030";

  it("gives one fixture every one of its reasons, in the order they arrived", () => {
    // The case the card has to render: two faults on one fixture are corrected separately, so both are
    // stated rather than the second replacing the first.
    const grouped = groupBracketFaultsBySpielId([
      { reason: "spiel_missing", spiel_id: twentyNine, spiel_nr: 29, quelle_spiel_nr: 99 },
      { reason: "same_team", spiel_id: twentyNine, spiel_nr: 29 },
    ]);

    assert.deepEqual(grouped.get(twentyNine), [
      "Verweist auf Spiel 99, das es in dieser Saison nicht gibt.",
      "Beide Seiten führen zur selben Mannschaft.",
    ]);
  });

  it("files each fixture's faults under its own id", () => {
    const grouped = groupBracketFaultsBySpielId([
      { reason: "same_team", spiel_id: twentyNine, spiel_nr: 29 },
      { reason: "same_team", spiel_id: thirty, spiel_nr: 30 },
    ]);

    assert.equal(grouped.size, 2);
    // No match number in the wording: the note sits on the card that already leads with it.
    assert.deepEqual(grouped.get(thirty), ["Beide Seiten führen zur selben Mannschaft."]);
  });

  it("keys on the id and not the number, which repeats across seasons", () => {
    // `GET /spiele/action_required` spans every season, so two fixtures numbered 29 reach this together
    // and a number-keyed map would show one season's reason on the other season's card.
    const grouped = groupBracketFaultsBySpielId([
      { reason: "same_team", spiel_id: twentyNine, spiel_nr: 29 },
      { reason: "spiel_missing", spiel_id: thirty, spiel_nr: 29, quelle_spiel_nr: 99 },
    ]);

    assert.deepEqual([...grouped.keys()], [twentyNine, thirty]);
  });

  it("returns an empty map for a season with no faults", () => {
    assert.equal(groupBracketFaultsBySpielId([]).size, 0);
  });
});

// A minimal bracket fixture for the wiring derivations: only the fields they read.
function makeBracketSpiel(
  id: string,
  nr: number,
  phase: FLSpiel["saison_phase"],
  quelle1: FLSpiel["team1_quelle"] = null,
  quelle2: FLSpiel["team2_quelle"] = null,
  saisonId = "2026",
): FLSpiel {
  return { id, spiel_nr: nr, saison_phase: phase, saison_id: saisonId, team1_quelle: quelle1, team2_quelle: quelle2 } as FLSpiel;
}

describe("quelleKey", () => {
  it("collides exactly when two references name the same outcome", () => {
    assert.equal(quelleKey({ type: "spiel", spiel_nr: 25, ausgang: "sieger" }), quelleKey({ type: "spiel", spiel_nr: 25, ausgang: "sieger" }));
    assert.notEqual(
      quelleKey({ type: "spiel", spiel_nr: 25, ausgang: "sieger" }),
      quelleKey({ type: "spiel", spiel_nr: 25, ausgang: "verlierer" }),
    );
  });

  // The variant tag leads the key, so `spiel` 1 and `platz` 1 can never read as the same source.
  it("keeps the two variants apart whatever their numbers", () => {
    assert.notEqual(quelleKey({ type: "spiel", spiel_nr: 1, ausgang: "sieger" }), quelleKey({ type: "gruppe", gruppe: "A", platz: 1 }));
  });
});

describe("collectUsedQuelleKeys", () => {
  const season = [
    makeBracketSpiel("id-25", 25, "viertelfinale", { type: "gruppe", gruppe: "A", platz: 1 }, { type: "gruppe", gruppe: "B", platz: 2 }),
    makeBracketSpiel("id-29", 29, "halbfinale", { type: "spiel", spiel_nr: 25, ausgang: "sieger" }, null),
  ];

  it("collects every stored source except the edited fixture's own", () => {
    const used = collectUsedQuelleKeys(season, "id-29");

    assert.equal(used.size, 2);
    assert.ok(used.has(quelleKey({ type: "gruppe", gruppe: "A", platz: 1 })));
    assert.ok(!used.has(quelleKey({ type: "spiel", spiel_nr: 25, ausgang: "sieger" })));
  });

  it("collects everything when the edited fixture is not in the list", () => {
    assert.equal(collectUsedQuelleKeys(season, "id-99").size, 3);
  });
});

describe("collectSpieltagTeamOccupancy", () => {
  // Only the fields the derivation reads — a side is its team id, a fixture its matchday.
  const spiel = (id: string, spieltagId: string, nr: number, team1: string | null, team2: string | null): FLSpiel =>
    ({
      id,
      spieltag_id: spieltagId,
      spiel_nr: nr,
      team1: team1 === null ? null : { team_id: team1 },
      team2: team2 === null ? null : { team_id: team2 },
    }) as FLSpiel;

  const season = [
    spiel("id-29", "tag-9", 29, "team-a", null),
    spiel("id-30", "tag-9", 30, "team-b", "team-c"),
    spiel("id-25", "tag-8", 25, "team-d", null),
  ];

  it("maps each team of the same Spieltag to the fixture that fields it, skipping the edited one", () => {
    const occupancy = collectSpieltagTeamOccupancy(season, { id: "id-29", spieltag_id: "tag-9" });

    assert.deepEqual(
      [...occupancy.entries()],
      [
        ["team-b", 30],
        ["team-c", 30],
      ],
    );
  });

  it("ignores fixtures of other Spieltage entirely — a team may well play next round", () => {
    const occupancy = collectSpieltagTeamOccupancy(season, { id: "id-30", spieltag_id: "tag-9" });

    assert.equal(occupancy.has("team-d"), false);
    assert.equal(occupancy.get("team-a"), 29);
  });
});

describe("listFeederSpiele", () => {
  const season = [
    makeBracketSpiel("id-1", 1, "gruppenphase"),
    makeBracketSpiel("id-26", 26, "viertelfinale"),
    makeBracketSpiel("id-25", 25, "viertelfinale"),
    makeBracketSpiel("id-29", 29, "halbfinale"),
    makeBracketSpiel("id-31", 31, "finale"),
    makeBracketSpiel("id-90", 90, "viertelfinale", null, null, "2025"),
  ];

  it("offers only knockout matches of a strictly earlier round, in bracket order", () => {
    const feeders = listFeederSpiele(season, { id: "id-29", saison_id: "2026", saison_phase: "halbfinale" });
    assert.deepEqual(
      feeders.map((spiel) => spiel.spiel_nr),
      [25, 26],
    );
  });

  // The first knockout round is seeded from the group phase: no match feeds it, so the
  // sieger/verlierer answers legitimately do not exist for it.
  it("offers nothing to a fixture of the first knockout round", () => {
    assert.deepEqual(listFeederSpiele(season, { id: "id-25", saison_id: "2026", saison_phase: "viertelfinale" }), []);
  });

  it("never offers a match of another season, whatever its round", () => {
    const feeders = listFeederSpiele(season, { id: "id-31", saison_id: "2026", saison_phase: "finale" });
    assert.ok(feeders.every((spiel) => spiel.saison_id === "2026"));
  });

  it("never offers the fixture itself", () => {
    const feeders = listFeederSpiele(season, { id: "id-26", saison_id: "2026", saison_phase: "halbfinale" });
    assert.deepEqual(
      feeders.map((spiel) => spiel.id),
      ["id-25"],
    );
  });
});

describe("listDependentSpiele", () => {
  const season = [
    makeBracketSpiel("id-1", 1, "gruppenphase"),
    makeBracketSpiel("id-25", 25, "viertelfinale", { type: "gruppe", gruppe: "A", platz: 1 }, { type: "gruppe", gruppe: "B", platz: 2 }),
    makeBracketSpiel("id-26", 26, "viertelfinale", { type: "gruppe", gruppe: "C", platz: 1 }, null),
    makeBracketSpiel("id-29", 29, "halbfinale", { type: "spiel", spiel_nr: 25, ausgang: "sieger" }, null),
    makeBracketSpiel("id-30", 30, "halbfinale", { type: "spiel", spiel_nr: 25, ausgang: "verlierer" }, null),
    makeBracketSpiel("id-90", 90, "halbfinale", { type: "spiel", spiel_nr: 25, ausgang: "sieger" }, null, "2025"),
  ];

  // Either outcome of the named fixture moves the slot, so `ausgang` is not part of the match.
  it("names every fixture fed by this one, whichever outcome it takes, in bracket order", () => {
    const dependent = listDependentSpiele(season, { id: "id-25", saison_id: "2026", saison_phase: "viertelfinale", spiel_nr: 25 }, []);
    assert.deepEqual(
      dependent.map((spiel) => spiel.spiel_nr),
      [29, 30],
    );
  });

  it("never names a fixture of another season", () => {
    const dependent = listDependentSpiele(season, { id: "id-25", saison_id: "2026", saison_phase: "viertelfinale", spiel_nr: 25 }, []);
    assert.ok(dependent.every((spiel) => spiel.saison_id === "2026"));
  });

  // A group result changes the standings, which decide every placing seeded from that group — the
  // route an admin correcting a group score actually takes.
  it("names the slots seeded from a group the fixture is played in", () => {
    const dependent = listDependentSpiele(season, { id: "id-1", saison_id: "2026", saison_phase: "gruppenphase", spiel_nr: 1 }, ["A"]);
    assert.deepEqual(
      dependent.map((spiel) => spiel.spiel_nr),
      [25],
    );
  });

  it("names nothing for a group nobody seeds from", () => {
    assert.deepEqual(listDependentSpiele(season, { id: "id-1", saison_id: "2026", saison_phase: "gruppenphase", spiel_nr: 1 }, ["D"]), []);
  });

  // The group route belongs to the group phase alone: a knockout fixture's own result decides nothing
  // about any group's standings, so a `gruppe`-fed slot is not downstream of it.
  it("ignores the group route on a knockout fixture", () => {
    assert.deepEqual(listDependentSpiele(season, { id: "id-31", saison_id: "2026", saison_phase: "finale", spiel_nr: 31 }, ["A", "B"]), []);
  });

  it("never names the fixture itself", () => {
    const dependent = listDependentSpiele(season, { id: "id-29", saison_id: "2026", saison_phase: "halbfinale", spiel_nr: 29 }, []);
    assert.deepEqual(dependent, []);
  });
});

describe("adminSpielEditHref", () => {
  it("addresses one fixture by its id", () => {
    assert.equal(adminSpielEditHref("6890a1b2c3d4e5f607182932"), "/admin/spiele/6890a1b2c3d4e5f607182932");
  });
});
