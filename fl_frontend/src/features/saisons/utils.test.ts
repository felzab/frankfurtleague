import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { RECORDED_FACTS_ANY, RECORDED_FACTS_NONE } from "./constants.ts";
// Relative import, not the "@/" alias: Node's resolver does not read tsconfig paths.
import {
  buildSpielplanBestand,
  buildSpielplanVorschau,
  buildSpieltagBound,
  describeAngesetzteSpiele,
  describeSpielplanUmfang,
  holdsDrawnSpiele,
  searchWithoutSaisonId,
} from "./utils.ts";

import type { FLSpiel } from "../spiele/schemas.ts";

describe("searchWithoutSaisonId", () => {
  it("returns a bare ? when the season was the only parameter", () => {
    assert.equal(searchWithoutSaisonId({ saison_id: "2027" }), "?");
  });

  it("returns a bare ? for an empty query", () => {
    assert.equal(searchWithoutSaisonId({}), "?");
  });

  it("keeps every other parameter", () => {
    assert.equal(searchWithoutSaisonId({ saison_id: "2027", suche: "eintracht", sort_by: "name" }), "?suche=eintracht&sort_by=name");
  });

  it("keeps a repeated parameter's every value", () => {
    assert.equal(searchWithoutSaisonId({ saison_id: "2027", gruppe: ["a", "b"] }), "?gruppe=a&gruppe=b");
  });

  it("drops an undefined value rather than serialising it", () => {
    assert.equal(searchWithoutSaisonId({ saison_id: "2027", suche: undefined, sort_by: "name" }), "?sort_by=name");
  });

  it("percent-encodes what it keeps", () => {
    assert.equal(searchWithoutSaisonId({ saison_id: "2027", suche: "sv 07 & co" }), "?suche=sv+07+%26+co");
  });

  it("strips a repeated saison_id too", () => {
    // A repeated parameter reaches the resolver as an array, which no season id matches.
    assert.equal(searchWithoutSaisonId({ saison_id: ["2025", "2026"], suche: "x" }), "?suche=x");
  });
});

describe("holdsDrawnSpiele", () => {
  /* `saison_phase=playoffs` compiles to every phase but `gruppenphase`, so a knockout-only season is
     drawn as much as a group-only one, and one read alone would offer it a rollover with no undo. */
  it("answers true from either half of the partition alone", () => {
    assert.equal(holdsDrawnSpiele({ gruppenSpiele: [{}], playoffSpiele: [] }), true);
    assert.equal(holdsDrawnSpiele({ gruppenSpiele: [], playoffSpiele: [{}] }), true);
    assert.equal(holdsDrawnSpiele({ gruppenSpiele: [{}, {}], playoffSpiele: [{}] }), true);
  });

  it("answers false only for a season with neither", () => {
    assert.equal(holdsDrawnSpiele({ gruppenSpiele: [], playoffSpiele: [] }), false);
  });
});

describe("buildSpielplanBestand", () => {
  const TEAM_1 = "2".repeat(24);
  const TEAM_2 = "3".repeat(24);

  const seite = (tore: number | null, teamId: string): FLSpiel["team1"] => ({
    team_id: teamId,
    tore,
    name: "SV Beispiel",
    shorthand: "SVB",
    austritt_type: null,
  });

  const QUELLE: FLSpiel["team1_quelle"] = { type: "gruppe", gruppe: "A", platz: 1 };

  /**
   * A group fixture as the draw leaves it: both sides OCCUPIED, neither wired, nothing entered. An
   * empty-sided one is an EMPTIED fixture instead, which is a state the endpoint counts.
   */
  const GRUPPENSPIEL: FLSpiel = {
    id: "0".repeat(24),
    spieltag_id: "1".repeat(24),
    team1: seite(null, TEAM_1),
    team2: seite(null, TEAM_2),
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

  /** A bracket fixture as the draw leaves it — WIRED and empty, the exact inverse of the group shape. */
  const KOSPIEL: FLSpiel = {
    ...GRUPPENSPIEL,
    saison_phase: "halbfinale",
    team1: null,
    team2: null,
    team1_quelle: QUELLE,
    team2_quelle: { type: "spiel", spiel_nr: 3, ausgang: "sieger" },
  };

  const spiel = (fields: Partial<FLSpiel> = {}): FLSpiel => ({ ...GRUPPENSPIEL, ...fields });
  const koSpiel = (fields: Partial<FLSpiel> = {}): FLSpiel => ({ ...KOSPIEL, ...fields });

  // Two helpers rather than one: `saison_phase` decides how a fixture is read, so a bracket document
  // handed to the group list would be a state no season reaches.
  const bestandOf = (...spiele: FLSpiel[]) => buildSpielplanBestand({ gruppenSpiele: spiele, playoffSpiele: [] });
  const koBestandOf = (...spiele: FLSpiel[]) => buildSpielplanBestand({ gruppenSpiele: [], playoffSpiele: spiele });

  const ORT: FLSpiel["ort"] = { spielort_id: "3".repeat(24), name: "Platz 1", maps_link: "https://example.invalid" };
  const SCHIRI: FLSpiel["schiedsrichter"] = { schiedsrichter_id: "4".repeat(24), name: "A. Beispiel" };

  /* BOTH shapes the draw writes, because the predicate reads them as inverses. Judge a side without
     its phase and one of the two reads as an edit, which shuts the window on every drawn season. */
  it("counts a freshly drawn season as holding fixtures and nothing else", () => {
    assert.deepEqual(buildSpielplanBestand({ gruppenSpiele: [spiel(), spiel()], playoffSpiele: [koSpiel()] }), {
      spiele: 3,
      erfasst: 0,
      angesetzt: 0,
    });
  });

  /* `playoffs` is every phase but `gruppenphase`, so a season whose only played fixture sits in the
     bracket would be replaced over a recorded result if one read were dropped. The tie is a played
     one: which CLAUSE answers belongs to the cases below. */
  it("counts both halves of the season's partition", () => {
    const gespielt = koSpiel({ team1: seite(2, TEAM_1), team2: seite(1, TEAM_2), ergebnis: "2:1" });

    assert.deepEqual(buildSpielplanBestand({ gruppenSpiele: [spiel()], playoffSpiele: [gespielt] }), {
      spiele: 2,
      erfasst: 1,
      angesetzt: 0,
    });
  });

  /* Mirrors `holds_a_recorded_fact`, which takes EVERY `sonderereignis`. Reach for `hasTakenPlace`'s
     narrower set instead and this fails: a called-off season would be offered a replace the endpoint
     answers with `REQ-SPIELPLAN-005`. */
  it("counts a cancellation as recorded, alongside an abandonment and a no-show", () => {
    assert.equal(bestandOf(spiel({ sonderereignis: "abgebrochen" })).erfasst, 1);
    assert.equal(bestandOf(spiel({ sonderereignis: "nichtantreten_team1" })).erfasst, 1);
    assert.equal(bestandOf(spiel({ sonderereignis: "nichtantreten_team2" })).erfasst, 1);

    assert.equal(bestandOf(spiel({ sonderereignis: "ausgefallen" })).erfasst, 1);
    assert.equal(bestandOf(spiel({ sonderereignis: "annulliert" })).erfasst, 1);
  });

  /* The clause a reader would not predict, and the endpoint has it: a fixture can hold one side's
     goals with no `ergebnis` at all, and replacing it would delete a number somebody entered. Zero is
     one of them, which is why the drawn sides carry `null`. */
  it("counts a lone goal count on either side as recorded", () => {
    assert.equal(bestandOf(spiel({ team1: seite(2, TEAM_1) })).erfasst, 1);
    assert.equal(bestandOf(spiel({ team2: seite(0, TEAM_2) })).erfasst, 1);
  });

  /* Stored only beside a result, so one standing alone got there by hand. Read `ergebnis` for both
     and a replace deletes a shoot-out whose fixture the same press was told held nothing. */
  it("counts a shoot-out standing without a result", () => {
    assert.equal(bestandOf(spiel({ elfmeterschiessen: { team1: 5, team2: 4 } })).erfasst, 1);
  });

  /* `_a_side_is_off_the_draw`'s group half, one clause per assertion: the draw leaves a group fixture
     occupied, so an emptied side is somebody's edit. */
  it("counts a group fixture whose side was emptied", () => {
    assert.equal(bestandOf(spiel({ team1: null })).erfasst, 1);
    assert.equal(bestandOf(spiel({ team2: null })).erfasst, 1);
  });

  /* The other group clause: the draw wires no group side, so a provenance on one was put there by
     hand. The side is left occupied, so no other clause can be what answers. */
  it("counts a group fixture carrying a provenance", () => {
    assert.equal(bestandOf(spiel({ team1_quelle: QUELLE })).erfasst, 1);
    assert.equal(bestandOf(spiel({ team2_quelle: QUELLE })).erfasst, 1);
  });

  /* The bracket half inverts it: the draw leaves the slot EMPTY, so an occupied one was filled by
     somebody — by hand, or by the resolution the group phase feeds. The provenance is left standing,
     so the clause below cannot be what answers. */
  it("counts a bracket slot that holds a club", () => {
    assert.equal(koBestandOf(koSpiel({ team1: seite(null, TEAM_1) })).erfasst, 1);
    assert.equal(koBestandOf(koSpiel({ team2: seite(null, TEAM_2) })).erfasst, 1);
  });

  /* Clearing the provenance is the one way out of automatic upkeep, and it is the edit the shared
     German calls a Herkunft. The slot is left empty, so the occupancy clause cannot be what answers. */
  it("counts a bracket slot whose provenance was cleared", () => {
    assert.equal(koBestandOf(koSpiel({ team1_quelle: null })).erfasst, 1);
    assert.equal(koBestandOf(koSpiel({ team2_quelle: null })).erfasst, 1);
  });

  /* The state the window was judged wrong on: an admin seeded ONE slot by hand, which fills the side
     and clears its provenance together, over a draw that is otherwise untouched. */
  it("counts a bracket slot seeded by hand over an otherwise untouched draw", () => {
    const seeded = koSpiel({ team1: seite(null, TEAM_1), team1_quelle: null });

    assert.deepEqual(buildSpielplanBestand({ gruppenSpiele: [spiel(), spiel()], playoffSpiele: [seeded] }), {
      spiele: 3,
      erfasst: 1,
      angesetzt: 0,
    });
  });

  /* The phase is the whole of what tells the two shapes apart, so one pairing is the draw's own under
     one phase and an edit under the other. Hardcode either shape and one of these reads 0. */
  it("reads one pairing as drawn or as an edit, according to the phase", () => {
    assert.equal(koBestandOf({ ...GRUPPENSPIEL, saison_phase: "finale" }).erfasst, 1);
    assert.equal(bestandOf({ ...KOSPIEL, saison_phase: "gruppenphase" }).erfasst, 1);
  });

  /* A booking is work the draw did not write, so the endpoint counts it and the replace closes on it.
     Leave either out and the panel offers a press that comes back a 409. */
  it("counts a venue and a referee as recorded, which is what closes the replace", () => {
    assert.equal(bestandOf(spiel({ ort: ORT })).erfasst, 1);
    assert.equal(bestandOf(spiel({ schiedsrichter: SCHIRI })).erfasst, 1);
  });

  /* Drop the note clause and this fails: an admin's note is work the draw never wrote, so the
     endpoint counts it and a replace offered over one comes back a 409. Trim rather than compare to
     null: a blank is no record. */
  it("counts a note as recorded, and a blank one as nothing", () => {
    assert.equal(bestandOf(spiel({ notiz: "Platz gesperrt" })).erfasst, 1);

    assert.equal(bestandOf(spiel({ notiz: "   " })).erfasst, 0);
    assert.equal(bestandOf(spiel({ notiz: "" })).erfasst, 0);
  });

  /* A date does NOT close the window, so it is the one thing the confirmation still has to name. Add
     the bookings back here and the readout claims a loss on a season the control never offers. */
  it("counts a date and a kickoff time as scheduled, and a booking as neither", () => {
    assert.equal(bestandOf(spiel({ datum: "2026-05-09" })).angesetzt, 1);
    assert.equal(bestandOf(spiel({ uhrzeit: "14:30" })).angesetzt, 1);

    assert.equal(bestandOf(spiel({ ort: ORT })).angesetzt, 0);
    assert.equal(bestandOf(spiel({ schiedsrichter: SCHIRI })).angesetzt, 0);
  });

  /* The two figures answer different questions, and only `erfasst` closes the replace. A merely dated
     season is replaceable, which is precisely why the other figure is carried at all. */
  it("keeps the scheduled count out of the recorded one", () => {
    const bestand = bestandOf(spiel({ datum: "2026-05-09", uhrzeit: "14:30" }), spiel({ ergebnis: "1:1" }));

    assert.deepEqual(bestand, { spiele: 2, erfasst: 1, angesetzt: 1 });
  });

  it("counts nothing for a season holding no fixtures", () => {
    assert.deepEqual(buildSpielplanBestand({ gruppenSpiele: [], playoffSpiele: [] }), { spiele: 0, erfasst: 0, angesetzt: 0 });
  });
});

describe("buildSpielplanVorschau", () => {
  /* Every schedule below is one `fl_backend/app/api/saisons/schedule.py :: schedule_for` composes, so
     a rules combination that reaches this derivation reaches it in this shape. */

  it("sums a season whose bracket runs several rounds", () => {
    // Four groups of four with two qualifying: 8 reach the bracket, so it opens at the quarter-final.
    assert.deepEqual(
      buildSpielplanVorschau([
        { phase: "gruppenphase", matchdays: 3, matches_per_matchday: 8 },
        { phase: "viertelfinale", matchdays: 1, matches_per_matchday: 4 },
        { phase: "halbfinale", matchdays: 1, matches_per_matchday: 2 },
        { phase: "finale", matchdays: 1, matches_per_matchday: 1 },
      ]),
      { spieltage: 6, spiele: 31, koRunden: ["viertelfinale", "halbfinale", "finale"] },
    );
  });

  // One group of two with both qualifying, which is the smallest `REQ-RULES-001` allows: the one
  // group fixture and the final are two matchdays, never one.
  it("sums the smallest season the rules allow", () => {
    assert.deepEqual(
      buildSpielplanVorschau([
        { phase: "gruppenphase", matchdays: 1, matches_per_matchday: 1 },
        { phase: "finale", matchdays: 1, matches_per_matchday: 1 },
      ]),
      { spieltage: 2, spiele: 2, koRunden: ["finale"] },
    );
  });

  /* Two groups of five, two qualifying. The regression a hand-written mirror produces: five matchdays
     rather than four, because a round that cannot pair everyone byes one team per group. */
  it("counts an odd group's bye matchday without counting a fixture for it", () => {
    assert.deepEqual(
      buildSpielplanVorschau([
        { phase: "gruppenphase", matchdays: 5, matches_per_matchday: 4 },
        { phase: "halbfinale", matchdays: 1, matches_per_matchday: 2 },
        { phase: "finale", matchdays: 1, matches_per_matchday: 1 },
      ]),
      // 20 group fixtures: two round robins of five, each ten fixtures over five matchdays of two.
      { spieltage: 7, spiele: 23, koRunden: ["halbfinale", "finale"] },
    );
  });

  /* `schedule_for` contributes no knockout phase where the qualifier count is not a power of two in
     range, so such a season is a group phase alone and the readout has no round to name. */
  it("names no round for a season whose qualifiers reach no bracket", () => {
    assert.deepEqual(buildSpielplanVorschau([{ phase: "gruppenphase", matchdays: 3, matches_per_matchday: 4 }]), {
      spieltage: 3,
      spiele: 12,
      koRunden: [],
    });
  });

  // Defensive rather than a state a resolved season reaches: every served schedule holds the group
  // phase, and zeros are what a caller must not read as a drawable season.
  it("counts nothing at all when no schedule was served", () => {
    assert.deepEqual(buildSpielplanVorschau([]), { spieltage: 0, spiele: 0, koRunden: [] });
  });
});

describe("describeSpielplanUmfang", () => {
  // One group of two with both qualifying: a group fixture and a final. The generator writes nothing
  // smaller, so no count below this reaches the phrase from a real season.
  it("counts the smallest draw the rules allow", () => {
    assert.equal(describeSpielplanUmfang(2, 2), "2 Spieltage und 2 Spiele");
  });

  it("counts a season-sized draw", () => {
    assert.equal(describeSpielplanUmfang(12, 96), "12 Spieltage und 96 Spiele");
  });

  // The singular branch, covered because the code has it rather than because a season reaches it:
  // the counts are the server's, and a fixed plural would report a 1 as "1 Spieltage".
  it("spells a count of one in the singular, which no season draws but the server could send", () => {
    assert.equal(describeSpielplanUmfang(1, 1), "ein Spieltag und ein Spiel");
    assert.equal(describeSpielplanUmfang(1, 6), "ein Spieltag und 6 Spiele");
  });
});

describe("describeAngesetzteSpiele", () => {
  /* `Keine` and not `0`: this stands in a readout row rather than in a sentence, and German counts
     nothing with a word. The zero is the common case, a fresh draw dating nothing. */
  it("names an empty count in words", () => {
    assert.equal(describeAngesetzteSpiele(0), "Keine");
  });

  it("spells one in the singular and the rest with the number", () => {
    assert.equal(describeAngesetzteSpiele(1), "ein Spiel");
    assert.equal(describeAngesetzteSpiele(28), "28 Spiele");
  });
});

describe("buildSpieltagBound", () => {
  const spieltag = (beginn: string | null, ende: string | null) => ({ beginn, ende });

  it("bounds the season by the earliest beginn and the latest ende", () => {
    assert.deepEqual(
      buildSpieltagBound([spieltag("2025-10-04", "2025-10-05"), spieltag("2025-09-06", "2025-09-07"), spieltag("2025-11-01", "2025-11-02")]),
      { startMax: "2025-09-06", endMin: "2025-11-02" },
    );
  });

  it("binds neither end for a season holding no matchday", () => {
    assert.deepEqual(buildSpieltagBound([]), { startMax: null, endMin: null });
  });

  /* The generator's own output: every matchday of a drawn season is undated until somebody dates it,
     and a bound of "" here is what `parseDate` throws on. */
  it("binds neither end when every matchday is undated", () => {
    assert.deepEqual(buildSpieltagBound([spieltag(null, null), spieltag(null, null)]), { startMax: null, endMin: null });
  });

  /* The regression: an unfiltered `sort()` stringifies null to "null", which sorts after every ISO
     date and takes the last position, so `endMin` came back as the undated row rather than October. */
  it("keeps the latest ende when a later matchday is still undated", () => {
    assert.deepEqual(buildSpieltagBound([spieltag("2025-09-06", "2025-09-07"), spieltag(null, null), spieltag("2025-10-04", "2025-10-05")]), {
      startMax: "2025-09-06",
      endMin: "2025-10-05",
    });
  });

  it("derives each end on its own, a matchday being able to carry one date and not the other", () => {
    assert.deepEqual(buildSpieltagBound([spieltag("2025-09-06", null), spieltag(null, "2025-10-05")]), {
      startMax: "2025-09-06",
      endMin: "2025-10-05",
    });
  });

  it("binds only the end a dated matchday reaches", () => {
    assert.deepEqual(buildSpieltagBound([spieltag(null, "2025-10-05")]), { startMax: null, endMin: "2025-10-05" });
  });
});

describe("the German the two windows share", () => {
  /* One sentence behind six call sites, so the panels and the two refusals cannot come to name
     different categories. Both articles are checked: German inflects the list, not just joins it. */
  it("names every category the endpoint counts, in both articles", () => {
    for (const [none, any] of [
      ["kein Ergebnis", "ein Ergebnis"],
      ["kein Ausfall", "ein Ausfall"],
      ["kein Ort", "ein Ort"],
      ["kein Schiedsrichter", "ein Schiedsrichter"],
      ["keine Notiz", "eine Notiz"],
      ["keine von Hand geänderte Herkunft", "eine von Hand geänderte Herkunft"],
    ] as const) {
      assert.ok(RECORDED_FACTS_NONE.includes(none), `the shared sentence drops ${none}`);
      assert.ok(RECORDED_FACTS_ANY.includes(any), `the shared sentence drops ${any}`);
    }
  });

  /* `Herkunft` is bracket-scoped on purpose: the predicate cannot always tell a hand-swapped group
     occupant from the draw's own, so a noun reaching group sides would promise detection it lacks. */
  it("claims nothing about every manual change being caught", () => {
    for (const sentence of [RECORDED_FACTS_NONE, RECORDED_FACTS_ANY]) {
      assert.doesNotMatch(sentence, /Änderung|geändertes Team|Aufstellung|Besetzung/);
    }
  });
});
