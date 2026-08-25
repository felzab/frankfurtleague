import assert from "node:assert/strict";
import { describe, it } from "node:test";

// Relative import, not the "@/" alias: Node's resolver does not read tsconfig paths.
import {
  buildSpielplanBestand,
  buildSpielplanVorschau,
  buildSpieltagBound,
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
  /** An ordinary undated fixture: nothing recorded, nothing scheduled, which is what a fresh draw writes. */
  const FRISCH: FLSpiel = {
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

  const seite = (tore: number | null): FLSpiel["team1"] => ({
    team_id: "2".repeat(24),
    tore,
    name: "SV Beispiel",
    shorthand: "SVB",
    austritt_type: null,
  });

  const spiel = (fields: Partial<FLSpiel> = {}): FLSpiel => ({ ...FRISCH, ...fields });

  const bestandOf = (...spiele: FLSpiel[]) => buildSpielplanBestand({ gruppenSpiele: spiele, playoffSpiele: [] });

  const ORT: FLSpiel["ort"] = { spielort_id: "3".repeat(24), name: "Platz 1", maps_link: "https://example.invalid" };
  const SCHIRI: FLSpiel["schiedsrichter"] = { schiedsrichter_id: "4".repeat(24), name: "A. Beispiel" };

  it("counts a freshly drawn season as holding fixtures and nothing else", () => {
    assert.deepEqual(bestandOf(spiel(), spiel(), spiel()), { spiele: 3, erfasst: 0, angesetzt: 0 });
  });

  /* `playoffs` is every phase but `gruppenphase`, so a season whose only played fixture sits in the
     bracket would be replaced over a recorded result if one read were dropped. */
  it("counts both halves of the season's partition", () => {
    assert.deepEqual(buildSpielplanBestand({ gruppenSpiele: [spiel()], playoffSpiele: [spiel({ ergebnis: "3:1" })] }), {
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
     goals with no `ergebnis` at all, and replacing it would delete a number somebody entered. */
  it("counts a lone goal count on either side as recorded", () => {
    assert.equal(bestandOf(spiel({ team1: seite(2) })).erfasst, 1);
    assert.equal(bestandOf(spiel({ team2: seite(0) })).erfasst, 1);
    assert.equal(bestandOf(spiel({ team1: seite(null), team2: seite(null) })).erfasst, 0);
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
