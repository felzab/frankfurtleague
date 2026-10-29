import { side as sharedSide, spielFields } from "@/test-support/fixtures.ts";
import { assert, describe, expect, it } from "vitest";

import { FLSpielSchema } from "../spiele/schemas.ts";
import { RECORDED_FACTS_ANY, RECORDED_FACTS_NONE } from "./constants.ts";
// Relative import, not the "@/" alias: Node's resolver does not read tsconfig paths.
import {
  buildGruppenOccupancy,
  buildSpielplanBestand,
  buildSpielplanVorschau,
  buildSpieltagBound,
  describeAngesetzteSpiele,
  describeKaderAustragung,
  describeKaderAustragungDanach,
  describeSpielplanPermanenz,
  describeSpielplanUmfang,
  holdsDrawnSpiele,
  holdsUndatierteSpieltage,
  searchWithoutSaisonId,
} from "./utils.ts";

import type { FLSpiel } from "../spiele/schemas.ts";

describe("searchWithoutSaisonId", () => {
  it("returns a bare ? when the season was the only parameter", () => {
    expect(searchWithoutSaisonId({ saison_id: "2027" })).toBe("?");
  });

  it("returns a bare ? for an empty query", () => {
    expect(searchWithoutSaisonId({})).toBe("?");
  });

  it("keeps every other parameter", () => {
    expect(searchWithoutSaisonId({ saison_id: "2027", suche: "eintracht", sort_by: "name" })).toBe("?suche=eintracht&sort_by=name");
  });

  it("keeps a repeated parameter's every value", () => {
    expect(searchWithoutSaisonId({ saison_id: "2027", gruppe: ["a", "b"] })).toBe("?gruppe=a&gruppe=b");
  });

  it("drops an undefined value rather than serialising it", () => {
    expect(searchWithoutSaisonId({ saison_id: "2027", suche: undefined, sort_by: "name" })).toBe("?sort_by=name");
  });

  it("percent-encodes what it keeps", () => {
    expect(searchWithoutSaisonId({ saison_id: "2027", suche: "sv 07 & co" })).toBe("?suche=sv+07+%26+co");
  });

  it("strips a repeated saison_id too", () => {
    // A repeated parameter reaches the resolver as an array, which no season id matches.
    expect(searchWithoutSaisonId({ saison_id: ["2025", "2026"], suche: "x" })).toBe("?suche=x");
  });
});

describe("holdsDrawnSpiele", () => {
  /* `saison_phase=playoffs` compiles to every phase but `gruppenphase`, so a knockout-only season is
     drawn as much as a group-only one, and one read alone would offer it a rollover with no undo. */
  it("answers true from either half of the partition alone", () => {
    expect(holdsDrawnSpiele({ gruppenSpiele: [{}], playoffSpiele: [] })).toBe(true);
    expect(holdsDrawnSpiele({ gruppenSpiele: [], playoffSpiele: [{}] })).toBe(true);
    expect(holdsDrawnSpiele({ gruppenSpiele: [{}, {}], playoffSpiele: [{}] })).toBe(true);
  });

  it("answers false only for a season with neither", () => {
    expect(holdsDrawnSpiele({ gruppenSpiele: [], playoffSpiele: [] })).toBe(false);
  });
});

describe("holdsUndatierteSpieltage", () => {
  /* One undated matchday among dated ones is the whole of `REQ-ACTIVATE-004`, and the case a count
     over a truncated list gets wrong in the other direction: nothing here may need every row. */
  it("answers true from a single undated matchday among dated ones", () => {
    expect(
      holdsUndatierteSpieltage([
        { beginn: "2026-09-05", ende: "2026-09-05" },
        { beginn: null, ende: null },
      ]),
    ).toBe(true);
  });

  it("answers false for a season whose matchdays are all dated, and for one holding none", () => {
    expect(holdsUndatierteSpieltage([{ beginn: "2026-09-05", ende: "2026-09-05" }])).toBe(false);
    expect(holdsUndatierteSpieltage([])).toBe(false);
  });

  /* `beginn` alone, though the row offers both ends: reading `ende` too would close a rollover
     `find_activation_refusal` allows, which is the mirror this derivation is for. */
  it("leaves a matchday that carries a beginn and no ende dated", () => {
    expect(holdsUndatierteSpieltage([{ beginn: "2026-09-05", ende: null }])).toBe(false);
  });
});

describe("buildGruppenOccupancy", () => {
  /* One key per group holding somebody, which is the shape `find_rules_refusal` and
     `find_spielplan_refusal` both index into. */
  it("counts the rows standing in each group", () => {
    expect(buildGruppenOccupancy([{ gruppe: "A" }, { gruppe: "A" }, { gruppe: "B" }])).toStrictEqual({ A: 2, B: 1 });
  });

  /* A group the season runs but nobody stands in carries no key, so every reader has to take an absent
     key as nobody — which is what `REQ-SPIELPLAN-004` reads it as. */
  it("gives a group holding nobody no key at all", () => {
    expect(buildGruppenOccupancy([{ gruppe: "B" }])).toStrictEqual({ B: 1 });
    expect(buildGruppenOccupancy([])).toStrictEqual({});
  });

  /* `buildReplacementContext` hands on a junction row whose club is gone, and its group is stored on
     that row alone: no read this page makes carries one. Placing it would close a row on a guess. */
  it("counts a row no club read reaches into no group", () => {
    expect(buildGruppenOccupancy([{ gruppe: "A" }, { gruppe: null }])).toStrictEqual({ A: 1 });
  });
});

describe("buildSpielplanBestand", () => {
  const TEAM_1 = "2".repeat(24);
  const TEAM_2 = "3".repeat(24);

  /**
   * The shared side, narrowed to this schema's own `austritt_type` union.
   *
   * `fl_frontend/src/test-support/fixtures.ts` types that field as a plain string, a module shared by
   * every slice's tests being unable to import one slice's schema.
   */
  const side = (teamId: string, tore: number | null = null): FLSpiel["team1"] => ({ ...sharedSide(teamId), tore, austritt_type: null });

  const QUELLE: FLSpiel["team1_quelle"] = { type: "gruppe", gruppe: "A", platz: 1 };

  // Parsed at construction: a field the shared literal has fallen behind on fails where the fixture
  // is built rather than wherever it is read.
  /**
   * A group fixture as the draw leaves it: both sides OCCUPIED, neither wired, nothing entered. An
   * empty-sided one is an EMPTIED fixture instead, which is a state the endpoint counts.
   */
  const GRUPPENSPIEL: FLSpiel = FLSpielSchema.parse(
    spielFields({ id: "0".repeat(24), spieltag_id: "1".repeat(24), team1: side(TEAM_1), team2: side(TEAM_2) }),
  );

  /** A bracket fixture as the draw leaves it — WIRED and empty, the exact inverse of the group shape. */
  const KOSPIEL: FLSpiel = FLSpielSchema.parse(
    spielFields({
      id: "0".repeat(24),
      spieltag_id: "1".repeat(24),
      saison_phase: "halbfinale",
      team1: null,
      team2: null,
      team1_quelle: QUELLE,
      team2_quelle: { type: "spiel", spiel_nr: 3, ausgang: "sieger" },
    }),
  );

  const spiel = (fields: Partial<FLSpiel> = {}): FLSpiel => ({ ...GRUPPENSPIEL, ...fields });
  const koSpiel = (fields: Partial<FLSpiel> = {}): FLSpiel => ({ ...KOSPIEL, ...fields });

  // Two helpers rather than one: `saison_phase` decides how a fixture is read, so a bracket document
  // handed to the group list would be a state no season reaches.
  const bestandOf = (...spiele: FLSpiel[]) => buildSpielplanBestand({ gruppenSpiele: spiele, playoffSpiele: [] });
  const koBestandOf = (...spiele: FLSpiel[]) => buildSpielplanBestand({ gruppenSpiele: [], playoffSpiele: spiele });

  const ORT: FLSpiel["ort"] = { spielort_id: "3".repeat(24), name: "Platz 1", maps_link: "https://example.invalid" };
  const REFEREE: FLSpiel["schiedsrichter"] = { schiedsrichter_id: "4".repeat(24), name: "A. Beispiel" };

  /* BOTH shapes the draw writes, because the predicate reads them as inverses. Judge a side without
     its phase and one of the two reads as an edit, which shuts the window on every drawn season. */
  it("counts a freshly drawn season as holding fixtures and nothing else", () => {
    expect(buildSpielplanBestand({ gruppenSpiele: [spiel(), spiel()], playoffSpiele: [koSpiel()] })).toStrictEqual({
      spiele: 3,
      erfasst: 0,
      angesetzt: 0,
    });
  });

  /* `playoffs` is every phase but `gruppenphase`, so a season whose only played fixture sits in the
     bracket would be replaced over a recorded result if one read were dropped. The tie is a played
     one: which CLAUSE answers belongs to the cases below. */
  it("counts both halves of the season's partition", () => {
    const played = koSpiel({ team1: side(TEAM_1, 2), team2: side(TEAM_2, 1), ergebnis: "2:1" });

    expect(buildSpielplanBestand({ gruppenSpiele: [spiel()], playoffSpiele: [played] })).toStrictEqual({
      spiele: 2,
      erfasst: 1,
      angesetzt: 0,
    });
  });

  /* Mirrors `holds_a_recorded_fact`, which takes EVERY `sonderereignis`. Reach for `hasTakenPlace`'s
     narrower set instead and this fails: a called-off season would be offered a replace the endpoint
     answers with `REQ-SPIELPLAN-005`. */
  it("counts a cancellation as recorded, alongside an abandonment and a no-show", () => {
    expect(bestandOf(spiel({ sonderereignis: "abgebrochen" })).erfasst).toBe(1);
    expect(bestandOf(spiel({ sonderereignis: "nichtantreten_team1" })).erfasst).toBe(1);
    expect(bestandOf(spiel({ sonderereignis: "nichtantreten_team2" })).erfasst).toBe(1);

    expect(bestandOf(spiel({ sonderereignis: "ausgefallen" })).erfasst).toBe(1);
    expect(bestandOf(spiel({ sonderereignis: "annulliert" })).erfasst).toBe(1);
  });

  /* The clause a reader would not predict, and the endpoint has it: a fixture can hold one side's
     goals with no `ergebnis` at all, and replacing it would delete a number somebody entered. Zero is
     one of them, which is why the drawn sides carry `null`. */
  it("counts a lone goal count on either side as recorded", () => {
    expect(bestandOf(spiel({ team1: side(TEAM_1, 2) })).erfasst).toBe(1);
    expect(bestandOf(spiel({ team2: side(TEAM_2, 0) })).erfasst).toBe(1);
  });

  /* Stored only beside a result, so one standing alone got there by hand. Read `ergebnis` for both
     and a replace deletes a shoot-out whose fixture the same press was told held nothing. */
  it("counts a shoot-out standing without a result", () => {
    expect(bestandOf(spiel({ elfmeterschiessen: { team1: 5, team2: 4 } })).erfasst).toBe(1);
  });

  /* `_a_side_is_off_the_draw`'s group half, one clause per assertion: the draw leaves a group fixture
     occupied, so an emptied side is somebody's edit. */
  it("counts a group fixture whose side was emptied", () => {
    expect(bestandOf(spiel({ team1: null })).erfasst).toBe(1);
    expect(bestandOf(spiel({ team2: null })).erfasst).toBe(1);
  });

  /* The other group clause: the draw wires no group side, so a provenance on one was put there by
     hand. The side is left occupied, so no other clause can be what answers. */
  it("counts a group fixture carrying a provenance", () => {
    expect(bestandOf(spiel({ team1_quelle: QUELLE })).erfasst).toBe(1);
    expect(bestandOf(spiel({ team2_quelle: QUELLE })).erfasst).toBe(1);
  });

  /* The bracket half inverts it: the draw leaves the slot EMPTY, so an occupied one was filled by
     somebody — by hand, or by the resolution the group phase feeds. The provenance is left standing,
     so the clause below cannot be what answers. */
  it("counts a bracket slot that holds a club", () => {
    expect(koBestandOf(koSpiel({ team1: side(TEAM_1) })).erfasst).toBe(1);
    expect(koBestandOf(koSpiel({ team2: side(TEAM_2) })).erfasst).toBe(1);
  });

  /* Clearing the provenance is the one way out of automatic upkeep, and it is the edit the shared
     German calls a Herkunft. The slot is left empty, so the occupancy clause cannot be what answers. */
  it("counts a bracket slot whose provenance was cleared", () => {
    expect(koBestandOf(koSpiel({ team1_quelle: null })).erfasst).toBe(1);
    expect(koBestandOf(koSpiel({ team2_quelle: null })).erfasst).toBe(1);
  });

  /* The state the window was judged wrong on: an admin seeded ONE slot by hand, which fills the side
     and clears its provenance together, over a draw that is otherwise untouched. */
  it("counts a bracket slot seeded by hand over an otherwise untouched draw", () => {
    const seeded = koSpiel({ team1: side(TEAM_1), team1_quelle: null });

    expect(buildSpielplanBestand({ gruppenSpiele: [spiel(), spiel()], playoffSpiele: [seeded] })).toStrictEqual({
      spiele: 3,
      erfasst: 1,
      angesetzt: 0,
    });
  });

  /* The phase is the whole of what tells the two shapes apart, so one pairing is the draw's own under
     one phase and an edit under the other. Hardcode either shape and one of these reads 0. */
  it("reads one pairing as drawn or as an edit, according to the phase", () => {
    expect(koBestandOf({ ...GRUPPENSPIEL, saison_phase: "finale" }).erfasst).toBe(1);
    expect(bestandOf({ ...KOSPIEL, saison_phase: "gruppenphase" }).erfasst).toBe(1);
  });

  /* A booking is work the draw did not write, so the endpoint counts it and the replace closes on it.
     Leave either out and the panel offers a press that comes back a 409. */
  it("counts a venue and a referee as recorded, which is what closes the replace", () => {
    expect(bestandOf(spiel({ ort: ORT })).erfasst).toBe(1);
    expect(bestandOf(spiel({ schiedsrichter: REFEREE })).erfasst).toBe(1);
  });

  /* Drop the note clause and this fails: an admin's note is work the draw never wrote, so the
     endpoint counts it and a replace offered over one comes back a 409. Trim rather than compare to
     null: a blank is no record. */
  it("counts a note as recorded, and a blank one as nothing", () => {
    expect(bestandOf(spiel({ notiz: "Platz gesperrt" })).erfasst).toBe(1);

    expect(bestandOf(spiel({ notiz: "   " })).erfasst).toBe(0);
    expect(bestandOf(spiel({ notiz: "" })).erfasst).toBe(0);
  });

  /* A date does NOT close the window, so it is the one thing the confirmation still has to name. Add
     the bookings back here and the readout claims a loss on a season the control never offers. */
  it("counts a date and a kickoff time as scheduled, and a booking as neither", () => {
    expect(bestandOf(spiel({ datum: "2026-05-09" })).angesetzt).toBe(1);
    expect(bestandOf(spiel({ uhrzeit: "14:30:00" })).angesetzt).toBe(1);

    expect(bestandOf(spiel({ ort: ORT })).angesetzt).toBe(0);
    expect(bestandOf(spiel({ schiedsrichter: REFEREE })).angesetzt).toBe(0);
  });

  /* The two figures answer different questions, and only `erfasst` closes the replace. A merely dated
     season is replaceable, which is precisely why the other figure is carried at all. */
  it("keeps the scheduled count out of the recorded one", () => {
    const bestand = bestandOf(spiel({ datum: "2026-05-09", uhrzeit: "14:30:00" }), spiel({ ergebnis: "1:1" }));

    expect(bestand).toStrictEqual({ spiele: 2, erfasst: 1, angesetzt: 1 });
  });

  it("counts nothing for a season holding no fixtures", () => {
    expect(buildSpielplanBestand({ gruppenSpiele: [], playoffSpiele: [] })).toStrictEqual({ spiele: 0, erfasst: 0, angesetzt: 0 });
  });
});

describe("buildSpielplanVorschau", () => {
  /* Every schedule below is one `fl_backend/app/api/saisons/schedule.py :: schedule_for` composes, so
     a rules combination that reaches this derivation reaches it in this shape. */

  it("sums a season whose bracket runs several rounds", () => {
    // Four groups of four with two qualifying: 8 reach the bracket, so it opens at the quarter-final.
    expect(
      buildSpielplanVorschau([
        { phase: "gruppenphase", matchdays: 3, matches_per_matchday: 8 },
        { phase: "viertelfinale", matchdays: 1, matches_per_matchday: 4 },
        { phase: "halbfinale", matchdays: 1, matches_per_matchday: 2 },
        { phase: "finale", matchdays: 1, matches_per_matchday: 1 },
      ]),
    ).toStrictEqual({ spieltage: 6, spiele: 31, koRunden: ["viertelfinale", "halbfinale", "finale"] });
  });

  // One group of two with both qualifying, which is the smallest `REQ-RULES-001` allows: the one
  // group fixture and the final are two matchdays, never one.
  it("sums the smallest season the rules allow", () => {
    expect(
      buildSpielplanVorschau([
        { phase: "gruppenphase", matchdays: 1, matches_per_matchday: 1 },
        { phase: "finale", matchdays: 1, matches_per_matchday: 1 },
      ]),
    ).toStrictEqual({ spieltage: 2, spiele: 2, koRunden: ["finale"] });
  });

  /* Two groups of five, two qualifying. The regression a hand-written mirror produces: five matchdays
     rather than four, because a round that cannot pair everyone byes one team per group. */
  it("counts an odd group's bye matchday without counting a fixture for it", () => {
    expect(
      buildSpielplanVorschau([
        { phase: "gruppenphase", matchdays: 5, matches_per_matchday: 4 },
        { phase: "halbfinale", matchdays: 1, matches_per_matchday: 2 },
        { phase: "finale", matchdays: 1, matches_per_matchday: 1 },
      ]),
    ).toStrictEqual({ spieltage: 7, spiele: 23, koRunden: ["halbfinale", "finale"] });
  });

  /* `schedule_for` contributes no knockout phase where the qualifier count is not a power of two in
     range, so such a season is a group phase alone and the readout has no round to name. */
  it("names no round for a season whose qualifiers reach no bracket", () => {
    expect(buildSpielplanVorschau([{ phase: "gruppenphase", matchdays: 3, matches_per_matchday: 4 }])).toStrictEqual({
      spieltage: 3,
      spiele: 12,
      koRunden: [],
    });
  });

  // Defensive rather than a state a resolved season reaches: every served schedule holds the group
  // phase, and zeros are what a caller must not read as a drawable season.
  it("counts nothing at all when no schedule was served", () => {
    expect(buildSpielplanVorschau([])).toStrictEqual({ spieltage: 0, spiele: 0, koRunden: [] });
  });
});

describe("describeSpielplanUmfang", () => {
  // One group of two with both qualifying: a group fixture and a final. The generator writes nothing
  // smaller, so no count below this reaches the phrase from a real season.
  it("counts the smallest draw the rules allow", () => {
    expect(describeSpielplanUmfang(2, 2)).toBe("2 Spieltage und 2 Spiele");
  });

  it("counts a season-sized draw", () => {
    expect(describeSpielplanUmfang(12, 96)).toBe("12 Spieltage und 96 Spiele");
  });

  // The singular branch, covered because the code has it rather than because a season reaches it:
  // the counts are the server's, and a fixed plural would report a 1 as "1 Spieltage".
  it("spells a count of one in the singular, which no season draws but the server could send", () => {
    expect(describeSpielplanUmfang(1, 1)).toBe("ein Spieltag und ein Spiel");
    expect(describeSpielplanUmfang(1, 6)).toBe("ein Spieltag und 6 Spiele");
  });
});

describe("describeAngesetzteSpiele", () => {
  /* `Keine` and not `0`: this stands in a readout row rather than in a sentence, and German counts
     nothing with a word. The zero is the common case, a fresh draw dating nothing. */
  it("names an empty count in words", () => {
    expect(describeAngesetzteSpiele(0)).toBe("Keine");
  });

  it("spells one in the singular and the rest with the number", () => {
    expect(describeAngesetzteSpiele(1)).toBe("ein Spiel");
    expect(describeAngesetzteSpiele(28)).toBe("28 Spiele");
  });
});

describe("buildSpieltagBound", () => {
  const spieltag = (beginn: string | null, ende: string | null) => ({ beginn, ende });

  it("bounds the season by the earliest beginn and the latest ende", () => {
    expect(
      buildSpieltagBound([spieltag("2025-10-04", "2025-10-05"), spieltag("2025-09-06", "2025-09-07"), spieltag("2025-11-01", "2025-11-02")]),
    ).toStrictEqual({ startMax: "2025-09-06", endMin: "2025-11-02" });
  });

  it("binds neither end for a season holding no matchday", () => {
    expect(buildSpieltagBound([])).toStrictEqual({ startMax: null, endMin: null });
  });

  /* The generator's own output: every matchday of a drawn season is undated until somebody dates it,
     and a bound of "" here is what `parseDate` throws on. */
  it("binds neither end when every matchday is undated", () => {
    expect(buildSpieltagBound([spieltag(null, null), spieltag(null, null)])).toStrictEqual({ startMax: null, endMin: null });
  });

  /* The regression: an unfiltered `sort()` stringifies null to "null", which sorts after every ISO
     date and takes the last position, so `endMin` came back as the undated row rather than October. */
  it("keeps the latest ende when a later matchday is still undated", () => {
    expect(
      buildSpieltagBound([spieltag("2025-09-06", "2025-09-07"), spieltag(null, null), spieltag("2025-10-04", "2025-10-05")]),
    ).toStrictEqual({
      startMax: "2025-09-06",
      endMin: "2025-10-05",
    });
  });

  it("derives each end on its own, a matchday being able to carry one date and not the other", () => {
    expect(buildSpieltagBound([spieltag("2025-09-06", null), spieltag(null, "2025-10-05")])).toStrictEqual({
      startMax: "2025-09-06",
      endMin: "2025-10-05",
    });
  });

  it("binds only the end a dated matchday reaches", () => {
    expect(buildSpieltagBound([spieltag(null, "2025-10-05")])).toStrictEqual({ startMax: null, endMin: "2025-10-05" });
  });
});

describe("the German the two windows share", () => {
  /* One sentence behind every call site, so the panels and the two refusals cannot come to name
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
      expect(sentence).not.toMatch(/Änderung|geändertes Team|Aufstellung|Besetzung/);
    }
  });
});

describe("describeSpielplanPermanenz", () => {
  /* A first draw on a PLANNED season has a repair, the undraw beside it (`REQ-SPIELPLAN-006`), so a permanence
     claim there sends an admin away from a control the panel offers. */
  it("points a first draw on a planned season at the undraw, inside the window it runs in", () => {
    const firstDraw = describeSpielplanPermanenz({ holdsADraw: false, saisonStatus: "future" });

    expect(firstDraw).toMatch(/Zurücknehmen lässt sich der Spielplan danach wieder hier/);
    // The window closes on anything entered, which „noch kein Spiel gewertet“ would understate.
    expect(firstDraw).toMatch(/zu keinem ihrer Spiele etwas eingetragen wurde/);
    expect(firstDraw).not.toMatch(/keinen Weg zurück/);
  });

  /* Nothing writes removed matchdays and fixtures back: `/spiele` has neither a create nor a delete. */
  it("claims no way back in every other state, and names the deletion wherever a draw is held", () => {
    for (const saisonStatus of ["future", "active", "past"] as const) {
      for (const holdsADraw of [true, false]) {
        if (!holdsADraw && saisonStatus === "future") continue;
        const sentence = describeSpielplanPermanenz({ holdsADraw, saisonStatus });

        expect(sentence, `${saisonStatus}, holding a draw: ${String(holdsADraw)}`).toMatch(/Es gibt in der Verwaltung keinen Weg zurück\./);
        if (holdsADraw) expect(sentence).toMatch(/Die Spieltage und Spiele oben werden dabei gelöscht\./);
      }
    }
  });
});

describe("the squad sentences of a replacement", () => {
  /* AUSTRAGEN and never STILLLEGEN (`docs/glossary.md`): the league-wide verb would claim these pupils left every
     season there is, and a deletion word that the rows went rather than being stamped. */
  it("word the squad rows with the verb a squad row takes, at the press and after it", () => {
    for (const sentence of [describeKaderAustragung("SG Alpha"), describeKaderAustragungDanach("SG Alpha")]) {
      expect(sentence).toMatch(/Kadereinträge von SG Alpha .*ausgetragen/);
      expect(sentence).not.toMatch(/stillgelegt|gelöscht|entfernt/);
    }
  });
});
