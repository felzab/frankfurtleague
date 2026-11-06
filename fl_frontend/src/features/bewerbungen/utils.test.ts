import { parseDate } from "@internationalized/date";
import { assert, describe, expect, it } from "vitest";

import { BEWERBUNG_MAX_ALTER, BEWERBUNG_MIN_ALTER, VERTRETUNG_MIN_ALTER } from "./constants.ts";
import { bewerbungHerkunft, bewerbungTeamName, buildBewerbungRows, describeAufnahme, geburtsdatumSpanne } from "./utils.ts";

import type { FLBewerbung } from "@/core/generated/client/types.ts";

/** The proposed school, of which only `team_name` decides the answer. */
const SCHOOL: FLBewerbung["schule"] = {
  team_name: "Ernst-Reuter",
  full_name: "Ernst-Reuter-Schule",
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
    expect(describeAufnahme({ createdTeam: true, gruppe: "A", saisonId: "2627" })).toBe(
      "Das Team wurde angelegt und in Gruppe A der Saison 2627 aufgenommen.",
    );
  });

  it("reads as a whole sentence where the club already stood", () => {
    expect(describeAufnahme({ createdTeam: false, gruppe: "B", saisonId: "2627" })).toBe(
      "Das Team wurde in Gruppe B der Saison 2627 aufgenommen.",
    );
  });

  /* One verb per arm, so neither can be produced by pasting a prefix onto a shared tail. */
  it("does not leave a verb stranded on either arm", () => {
    for (const createdTeam of [true, false]) {
      const sentence = describeAufnahme({ createdTeam, gruppe: "A", saisonId: "2627" });

      expect(sentence, "the report splices a state onto a past-tense tail").not.toMatch(/steht in .* aufgenommen/);
      expect(sentence, "the report is not one whole sentence").toMatch(/^Das Team wurde .* aufgenommen\.$/);
    }
  });
});

describe("the club an application names", () => {
  it("takes a proposed school's own name before any club list", () => {
    const named = bewerbungTeamName({ schule: SCHOOL, team_id: null }, TEAMS);

    expect(named).toBe("Ernst-Reuter");
  });

  it("resolves a picked club through the list", () => {
    expect(bewerbungTeamName({ schule: null, team_id: "6890a1b2c3d4e5f607190002" }, TEAMS)).toBe("Goethe");
  });

  /* The row `bewerbung_subject_unresolved` refuses, and the row a decline still has to address: nobody may
     guess a name for a message that goes out over the league's own address. */
  it("names nobody where the application names neither, and where the club is gone", () => {
    expect(bewerbungTeamName({ schule: null, team_id: null }, TEAMS)).toBe(null);
    expect(bewerbungTeamName({ schule: null, team_id: "6890a1b2c3d4e5f607190009" }, TEAMS)).toBe(null);
  });
});

describe("which of the two an application asks the league to enter", () => {
  it("is a new school where it proposes one", () => {
    expect(bewerbungHerkunft({ schule: SCHOOL, team_id: null })).toBe("neue_schule");
  });

  it("is an existing club where it picked one", () => {
    expect(bewerbungHerkunft({ schule: null, team_id: "6890a1b2c3d4e5f607190002" })).toBe("bestehendes_team");
  });

  /* An acceptance writes the created club's id back beside the school, so a decided new school carries
     both; asking the id first files it as a club that was already in the league. */
  it("stays a new school once the acceptance has named the club it created", () => {
    expect(bewerbungHerkunft({ schule: SCHOOL, team_id: "6890a1b2c3d4e5f607190002" })).toBe("neue_schule");
  });

  /* The row `bewerbung_subject_unresolved` refuses. Any answer but none here is a badge, a filter option and a
     panel title each claiming a club or a school the application never named. */
  it("is neither where the application names neither", () => {
    expect(bewerbungHerkunft({ schule: null, team_id: null })).toBe(null);
  });
});

/** One application, of which only `saison_id` decides anything below. */
function bewerbung(id: string, saisonId: string): FLBewerbung {
  return {
    id,
    version: 0,
    saison_id: saisonId,
    submitted_at: "2026-05-01",
    status: "submitted",
    team_id: null,
    schule: SCHOOL,
    kontakte: { trainer: null, ansprechperson: null, stellvertretung: null, trainer_is_also: null },
    trikot: { existing_satz: "12 rote Trikots", wunschfarbe: "rot" },
    kader: { expected_size: 14, good_spieler: 3 },
    stufengroesse: 96,
    wunschgegner: null,
    decision: null,
    confirmations: { trainer: null, ansprechperson: null, stellvertretung: null },
  };
}

const ACROSS_SAISONS = [bewerbung("6890a1b2c3d4e5f607190011", "2627"), bewerbung("6890a1b2c3d4e5f607190012", "2526")];

describe("which season a row belongs to", () => {
  /* The flag the season facet reads. Answered here rather than in the facet, which sees one row and
     never the season the header holds. */
  it("marks only the applications for the selected season", () => {
    const rows = buildBewerbungRows(ACROSS_SAISONS, TEAMS, "2627");

    expect(rows.map((row) => row.inSelectedSaison)).toStrictEqual([true, false]);
  });

  /* No active season and none named leaves the selector holding nothing, and a row claiming to be in
     that season would open the list on an answer nobody asked for. */
  it("marks none where no season is selected", () => {
    const rows = buildBewerbungRows(ACROSS_SAISONS, TEAMS, undefined);

    assert.ok(rows.every((row) => !row.inSelectedSaison));
  });

  it("keeps every application, the season being a facet rather than a cut", () => {
    expect(buildBewerbungRows(ACROSS_SAISONS, TEAMS, "2627").length).toBe(ACROSS_SAISONS.length);
  });
});

describe("the birthdate window a contact person's date has to fall in", () => {
  /* The endpoint's own rule restated rather than its result quoted, so both bounds are judged
     against what it accepts: whole years, a birthday not yet reached this year not having happened
     (`fl_backend/app/shared/age.py :: whole_years_between`). */
  function wholeYears(geboren: string, today2: string): number {
    const [gJahr = 0, gMonat = 0, gTag = 0] = geboren.split("-").map(Number);
    const [hJahr = 0, hMonat = 0, hTag = 0] = today2.split("-").map(Number);

    return hJahr - gJahr - (hMonat < gMonat || (hMonat === gMonat && hTag < gTag) ? 1 : 0);
  }

  const nextDay = (tag: string): string => parseDate(tag).add({ days: 1 }).toString();
  const previousDay = (tag: string): string => parseDate(tag).subtract({ days: 1 }).toString();

  /* Bounds and not an age: the picker needs a `minValue` and a `maxValue`, the schema needs a string
     comparison, and one derivation serving both is what stops the two drifting apart. */
  it("spans both bounds off today, and both ends are inclusive", () => {
    expect(geburtsdatumSpanne("2026-08-29", BEWERBUNG_MIN_ALTER)).toStrictEqual({ frueheste: "1905-08-30", spaeteste: "2010-08-29" });
  });

  /* The floor moves with the seat while the ceiling does not, so a derivation that read a constant
     for either would offer one seat a date the endpoint then refuses. */
  it("moves the floor's end with the seat and leaves the ceiling's where it is", () => {
    expect(geburtsdatumSpanne("2026-08-29", VERTRETUNG_MIN_ALTER)).toStrictEqual({ frueheste: "1905-08-30", spaeteste: "2008-08-29" });
  });

  /* A 29 February has no counterpart in a year that is not a leap year, 1903 and 2100 among them, so
     an arithmetic that kept the day would hand the picker a date its own parse refuses. */
  it("clamps a leap day onto the end of February where the target year has none", () => {
    expect(geburtsdatumSpanne("2024-02-29", BEWERBUNG_MIN_ALTER)).toStrictEqual({ frueheste: "1903-03-01", spaeteste: "2008-02-29" });
    expect(geburtsdatumSpanne("2116-02-29", BEWERBUNG_MIN_ALTER).spaeteste).toBe("2100-02-28");
  });

  /* Both tiers refuse the same set. A band the page turns away and the endpoint accepts is a
     contact person told to correct a date that was right. */
  it("ends both bounds exactly where the endpoint's whole-year count does, at either floor", () => {
    for (const mindestalter of [BEWERBUNG_MIN_ALTER, VERTRETUNG_MIN_ALTER]) {
      for (const today2 of ["2026-09-04", "2024-02-29", "2027-03-01", "2116-02-29"]) {
        const { frueheste, spaeteste } = geburtsdatumSpanne(today2, mindestalter);
        const wo = `${today2} at ${String(mindestalter)}`;

        expect(wholeYears(frueheste, today2), `${wo}: the earliest date offered is not the oldest accepted`).toBe(BEWERBUNG_MAX_ALTER);
        expect(wholeYears(previousDay(frueheste), today2), `${wo}: the day before it is accepted too`).toBe(BEWERBUNG_MAX_ALTER + 1);
        expect(wholeYears(spaeteste, today2), `${wo}: the latest date offered is not the youngest accepted`).toBe(mindestalter);
        expect(wholeYears(nextDay(spaeteste), today2), `${wo}: the day after it is accepted too`).toBe(mindestalter - 1);
      }
    }
  });
});
