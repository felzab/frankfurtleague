import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { bewerbungTeamName, buildBewerbungRows, describeAufnahme } from "./utils.ts";

import type { FLBewerbung } from "./schemas.ts";

/** The proposed school, of which only `team_name` decides the answer. */
const SCHULE: FLBewerbung["schule"] = {
  team_name: "Ernst-Reuter",
  full_name: "Ernst-Reuter-Schule",
  shorthand: "ER",
  schulform: "gesamtschule",
  address: { strasse: "Hammarskjöldring", hausnummer: "17a", plz: "60439", stadtteil: "Nordweststadt", stadt: "Frankfurt" },
  website_url: "https://ernst-reuter-schule.de",
};

const TEAMS = [
  { id: "6890a1b2c3d4e5f607190001", name: "Helmholtz" },
  { id: "6890a1b2c3d4e5f607190002", name: "Goethe" },
];

describe("what an acceptance reports", () => {
  /* Both arms, because a message spliced from a shared prefix renders only on one of them and
     nothing else in the app puts the sentence together. */
  it("reads as a whole sentence where the club was created", () => {
    assert.equal(
      describeAufnahme({ createdTeam: true, gruppe: "A", saisonId: "2627" }),
      "Das Team wurde angelegt und in Gruppe A der Saison 2627 aufgenommen.",
    );
  });

  it("reads as a whole sentence where the club already stood", () => {
    assert.equal(
      describeAufnahme({ createdTeam: false, gruppe: "B", saisonId: "2627" }),
      "Das Team wurde in Gruppe B der Saison 2627 aufgenommen.",
    );
  });

  /* One verb per arm, so neither can be produced by pasting a prefix onto a shared tail. */
  it("does not leave a verb stranded on either arm", () => {
    for (const createdTeam of [true, false]) {
      const sentence = describeAufnahme({ createdTeam, gruppe: "A", saisonId: "2627" });

      assert.doesNotMatch(sentence, /steht in .* aufgenommen/, "the report splices a state onto a past-tense tail");
      assert.match(sentence, /^Das Team wurde .* aufgenommen\.$/, "the report is not one whole sentence");
    }
  });
});

describe("the club an application names", () => {
  it("takes a proposed school's own name before any club list", () => {
    const named = bewerbungTeamName({ schule: SCHULE, team_id: null }, TEAMS);

    assert.equal(named, "Ernst-Reuter");
  });

  it("resolves a picked club through the list", () => {
    assert.equal(bewerbungTeamName({ schule: null, team_id: "6890a1b2c3d4e5f607190002" }, TEAMS), "Goethe");
  });

  /* The row `REQ-BEWERBUNG-002` refuses, and the row a decline still has to address: nobody may
     guess a name for a message that goes out over the league's own address. */
  it("names nobody where the application names neither, and where the club is gone", () => {
    assert.equal(bewerbungTeamName({ schule: null, team_id: null }, TEAMS), null);
    assert.equal(bewerbungTeamName({ schule: null, team_id: "6890a1b2c3d4e5f607190009" }, TEAMS), null);
  });
});

/** One application, of which only `saison_id` decides anything below. */
function bewerbung(id: string, saisonId: string): FLBewerbung {
  return {
    id,
    saison_id: saisonId,
    eingereicht_am: "2026-05-01",
    status: "eingereicht",
    team_id: null,
    schule: SCHULE,
    kontakte: { trainer: null, ansprechperson: null, stellvertretung: null, trainer_ist_ansprechperson: false },
    trikot: { vorhandener_satz: "12 rote Trikots", wunschfarbe: null },
    kader: { voraussichtliche_groesse: 14, gute_spieler: null },
    entscheidung: null,
  };
}

const ACROSS_SAISONS = [bewerbung("6890a1b2c3d4e5f607190011", "2627"), bewerbung("6890a1b2c3d4e5f607190012", "2526")];

describe("which season a row belongs to", () => {
  /* The flag the season facet reads. Answered here rather than in the facet, which sees one row and
     never the season the header holds. */
  it("marks only the applications for the selected season", () => {
    const rows = buildBewerbungRows(ACROSS_SAISONS, TEAMS, "2627");

    assert.deepEqual(
      rows.map((row) => row.inSelectedSaison),
      [true, false],
    );
  });

  /* No active season and none named leaves the selector holding nothing, and a row claiming to be in
     that season would open the list on an answer nobody asked for. */
  it("marks none where no season is selected", () => {
    const rows = buildBewerbungRows(ACROSS_SAISONS, TEAMS, undefined);

    assert.ok(rows.every((row) => !row.inSelectedSaison));
  });

  it("keeps every application, the season being a facet rather than a cut", () => {
    assert.equal(buildBewerbungRows(ACROSS_SAISONS, TEAMS, "2627").length, ACROSS_SAISONS.length);
  });
});
