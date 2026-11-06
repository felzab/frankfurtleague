import { answerShown, refusalCodes, refused } from "@/test-support/refusals.ts";
import { bodyField, refusedPayload } from "@/test-support/refusedPayload.ts";
import { parseDate } from "@internationalized/date";
import { assert, describe, expect, it } from "vitest";

import { TEAM_FACETS } from "@/features/teams/facets";
import { FELD_ABGELEHNT } from "@/shared/utils/actionError";

import { BEWERBUNG_MAX_ALTER, BEWERBUNG_MIN_ALTER, VERTRETUNG_MIN_ALTER } from "./constants.ts";
import {
  abiJahrgang,
  BEWERBUNG_VERALTET,
  bewerbungHerkunft,
  bewerbungJudgedPaths,
  bewerbungTeamName,
  buildBewerbungRows,
  describeAufnahme,
  fensterZustand,
  geburtsdatumSpanne,
  mapBewerbungSubmitRefusal,
  mirrorBewerbungTrainer,
} from "./utils.ts";

import type { Code, FLBewerbung, FLBewerbungWindowResponse } from "@/core/generated/client/types.ts";
import type { BewerbungKontakteDraft, BewerbungKontaktpersonDraft } from "./types.ts";

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

describe("which state the window puts the page in", () => {
  const fenster = (overrides: Partial<FLBewerbungWindowResponse> = {}): FLBewerbungWindowResponse => ({
    saison_id: "2627",
    start: "2026-05-01",
    end: "2026-07-31",
    running: false,
    saison_ended: false,
    ...overrides,
  });

  /* `laeuft` is the server's whole judgement against a clock this page does not share. Re-derived
     here, the page would offer the form for as long as the two clocks disagree. */
  it("takes the running answer from the server and never re-derives it", () => {
    expect(fensterZustand(fenster({ running: true }), "2020-01-01")).toBe("running");
    expect(fensterZustand(fenster({ running: true }), "2099-01-01")).toBe("running");
  });

  /* Each closed answer is a different sentence: one says when to come back, one that the season is
     done, one that the league shut it. Folded together, a school goes away for the wrong reason. */
  it("separates a window that has not opened from one that is over", () => {
    expect(fensterZustand(fenster(), "2026-04-30")).toBe("noch-nicht");
    expect(fensterZustand(fenster(), "2026-08-01")).toBe("vorbei");
  });

  /* `laeuft` false inside an open span is this clock disagreeing with the server's. Answered
     `vorbei`, the page would state a deadline nobody has reached. */
  it("never says a deadline passed while today is still inside the span", () => {
    expect(fensterZustand(fenster(), "2026-06-01")).toBe("closed");
  });

  /* A season taking no applications at all is its own answer. The page still renders — a school
     arriving on last year's link has a question, and a 404 answers none of it. */
  it("reads a season with no window as its own state rather than as expired", () => {
    expect(fensterZustand(null, "2026-06-01")).toBe("keine-frist");
  });

  /* An ended season takes no application again, so every date answer would send a school to wait
     for a window that never reopens: the span still running or a span not
     yet begun. */
  it("reads every window of a season that has ended as over, whatever its dates say", () => {
    expect(fensterZustand(fenster({ saison_ended: true }), "2026-06-01")).toBe("vorbei");
    expect(fensterZustand(fenster({ saison_ended: true }), "2026-04-30")).toBe("vorbei");
  });
});

describe("the Abi-Jahrgang a season fields", () => {
  /* The season the league actually holds. Read as two halves of a school year, `2026` answers 2021:
     five years past, on the one banner this page exists to carry. */
  it("is the year after the calendar year the id spells", () => {
    expect(abiJahrgang("2026")).toBe("2027");
  });

  /* Every fixture a school-year reading and a calendar one answer differently, which is what the
     single case above cannot be on its own: a fixture the two agree on proves neither. */
  it("reads the whole id as the year, never its first two digits", () => {
    expect(abiJahrgang("2027")).toBe("2028");
    expect(abiJahrgang("2030")).toBe("2031");
    // A century boundary falls out of the arithmetic rather than out of a `20` prefix.
    expect(abiJahrgang("2099")).toBe("2100");
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

describe("the public form's coach mirror", () => {
  const person = (vorname: string): BewerbungKontaktpersonDraft => ({
    first_name: vorname,
    last_name: "Mustermann",
    email: `${vorname.toLowerCase()}@beispiel.de`,
    phone: "069 1234567",
    einwilligung: { given: true },
  });

  const kontakte = (overrides: Partial<BewerbungKontakteDraft> = {}): BewerbungKontakteDraft => ({
    trainer: person("Tim"),
    ansprechperson: person("Erika"),
    stellvertretung: person("Lena"),
    trainer_is_also: null,
    ...overrides,
  });

  /* The direction is the whole of it, and the OPPOSITE of the admin editor's. Reversed, ticking the
     box would wipe the very person who was just declared to be the coach. */
  it("fills the Trainer seat from whichever seat declared itself the coach", () => {
    const mirroredPair = mirrorBewerbungTrainer(kontakte({ trainer_is_also: "ansprechperson" }));

    expect(mirroredPair.trainer.first_name).toBe("Erika");
    expect(mirroredPair.trainer, "the two seats hold two records rather than one").toBe(mirroredPair.ansprechperson);
    expect(mirroredPair.stellvertretung.first_name, "a seat the claim does not name was overwritten").toBe("Lena");
  });

  it("fills it from the Stellvertretung where that seat is the one that declared itself", () => {
    const mirroredPair = mirrorBewerbungTrainer(kontakte({ trainer_is_also: "stellvertretung" }));

    expect(mirroredPair.trainer.first_name).toBe("Lena");
    expect(mirroredPair.ansprechperson.first_name).toBe("Erika");
  });

  it("moves nobody while the claim names nobody", () => {
    const mirroredPair = mirrorBewerbungTrainer(kontakte());

    expect(mirroredPair.trainer.first_name).toBe("Tim");
    expect(mirroredPair.ansprechperson.first_name).toBe("Erika");
  });
});

describe("which paths one judgement covers in the public form", () => {
  /* The declaring seat's boxes are the only ones the Trainer's copy can be edited through, so a
     judgement that skipped the copy would leave its verdict standing over what the seat replaced. */
  it("judges the Trainer's copy alongside every field of the seat that feeds it", () => {
    expect(bewerbungJudgedPaths(["kontakte.ansprechperson.email"], "ansprechperson")).toStrictEqual([
      "kontakte.ansprechperson.email",
      "kontakte.trainer.email",
    ]);
    expect(bewerbungJudgedPaths(["kontakte.stellvertretung.phone"], "stellvertretung")).toStrictEqual([
      "kontakte.stellvertretung.phone",
      "kontakte.trainer.phone",
    ]);
  });

  it("reaches no second seat with an empty claim, and none from a seat the mirror does not feed", () => {
    expect(bewerbungJudgedPaths(["kontakte.ansprechperson.email"], null)).toStrictEqual(["kontakte.ansprechperson.email"]);
    expect(bewerbungJudgedPaths(["kontakte.stellvertretung.email"], "ansprechperson")).toStrictEqual(["kontakte.stellvertretung.email"]);
    expect(bewerbungJudgedPaths(["team_id"], "ansprechperson")).toStrictEqual(["team_id"]);
  });
});

describe("what a submission's refusal is shown as", () => {
  const refusal = (code: Code) => mapBewerbungSubmitRefusal(refused(code));

  /* Asserted before the arms below: a mapper that stopped recognising a 409 at all would return
     `null` everywhere, and every "names no field" assertion would pass over nothing. */
  it("recognises the submission's own codes at all", () => {
    for (const code of [
      "bewerbung_window_closed",
      "bewerbung_submission_subject_unresolved",
      "bewerbung_picked_team_unusable",
      "bewerbung_picked_team_already_entered",
    ] as const) {
      expect(refusal(code), `${code} reaches the applicant unmapped`).not.toBe(null);
    }
  });

  // The mark the form titles by: the application arrived, so „nicht abgeschickt“ would be false.
  it("marks the repeated press's refusal as arrived, and no other refusal", () => {
    expect(refusal("bewerbung_key_differing")?.schonAngekommen).toBe(true);
    for (const code of [
      "bewerbung_window_closed",
      "bewerbung_submission_subject_unresolved",
      "bewerbung_picked_team_unusable",
      "bewerbung_picked_team_already_entered",
    ] as const) {
      expect(refusal(code)?.schonAngekommen, code).toBe(undefined);
    }
  });

  /* A refusal naming a field has to land under the control at fault: as a toast it names a box the
     applicant then has to find, and this form has dozens of them. */
  it("puts each field refusal on the path its own input renders", () => {
    expect(Object.keys(refusal("bewerbung_submission_subject_unresolved")?.fieldErrors ?? {})).toStrictEqual(["team_id"]);
    expect(Object.keys(refusal("bewerbung_picked_team_unusable")?.fieldErrors ?? {})).toStrictEqual(["team_id"]);
    expect(Object.keys(refusal("bewerbung_picked_team_already_entered")?.fieldErrors ?? {})).toStrictEqual(["team_id"]);
  });

  /* The window closing mid-form is about the season rather than about anything typed, so it has no
     field to sit on and a reload is the whole remedy. */
  it("reports a closed window as a banner with no field on it", () => {
    expect(refusal("bewerbung_window_closed")?.fieldErrors).toBe(undefined);
    expect(refusal("bewerbung_window_closed")?.error ?? "").toMatch(/Lade die Seite neu/);
  });

  it("maps nothing it does not recognise, so an unknown code falls through to the shared handler", () => {
    expect(mapBewerbungSubmitRefusal(refused(undefined, 409))).toBe(null);
    expect(mapBewerbungSubmitRefusal(new Error("boom"))).toBe(null);
    // A write answered with a 5xx may have landed, which no refusal's words may deny.
    expect(mapBewerbungSubmitRefusal(refused("bewerbung_submission_subject_unresolved", 500))).toBe(null);
  });

  /* Codes are unique across the API, so a rule moved to another status keeps its answer. */
  it("answers a code alike at whatever status its rule answers with", () => {
    for (const code of ["bewerbung_submission_subject_unresolved", "bewerbung_key_differing"] as const) {
      expect(mapBewerbungSubmitRefusal(refused(code)), code).toStrictEqual(refusal(code));
    }
  });
});

describe("the submission's refusals against the codes its endpoint publishes", () => {
  /* The one class a unit test here CAN hold: a published code this maps nowhere reaches the applicant
     as the generic sentence, which names no field and no way out. */
  it("maps every code the submission publishes", () => {
    for (const code of refusalCodes(
      "duplicate_key",
      "bewerbung_window_closed",
      "bewerbung_submission_subject_unresolved",
      "bewerbung_picked_team_unusable",
      "bewerbung_picked_team_already_entered",
      "bewerbung_key_differing",
      "bewerbung_address_barred",
    )) {
      expect(answerShown(code, mapBewerbungSubmitRefusal), `${code} reaches the applicant unmapped`).not.toBe(null);
    }
  });

  /* One code, one answer. Sharing one sentence between two of them is the failure this catches:
     each names a different thing to change, and a reader given the wrong one changes the wrong box. */
  it("gives each code its own answer", () => {
    const answers = refusalCodes(
      "duplicate_key",
      "bewerbung_window_closed",
      "bewerbung_submission_subject_unresolved",
      "bewerbung_picked_team_unusable",
      "bewerbung_picked_team_already_entered",
      "bewerbung_key_differing",
      "bewerbung_address_barred",
    ).map((code) => JSON.stringify(mapBewerbungSubmitRefusal(refused(code))));

    expect(new Set(answers).size, "two codes are answered with the same sentence").toBe(answers.length);
  });

  /* Distinct is not the same as TRUE, which is all the case above can see. „Schon beworben“ and
     „spielt schon mit“ are two readings a German sentence separates and no structural check does —
     and only one is what the backend refuses. */
  it("says of each code what the backend constant it answers refuses", () => {
    const fieldOf = (code: Code) => Object.values(mapBewerbungSubmitRefusal(refused(code))?.fieldErrors ?? {}).join(" ");
    const banner = (code: Code) => mapBewerbungSubmitRefusal(refused(code))?.error ?? "";

    // The season stopped taking applications; nothing about the school is at fault.
    expect(banner("bewerbung_window_closed")).toMatch(/keine Bewerbungen/);
    expect(banner("bewerbung_window_closed")).not.toMatch(/Schule|Kürzel/);

    // Both-or-neither: the answer is the choice itself, not a clash with anything stored.
    expect(fieldOf("bewerbung_submission_subject_unresolved")).toMatch(/entweder/);
    expect(fieldOf("bewerbung_submission_subject_unresolved")).toMatch(/oder/);

    /* The picker never offered this club, so a reload is the primary repair; the new-school arm is an
       alternative. */
    expect(fieldOf("bewerbung_picked_team_unusable")).toMatch(/[Ll]ade die Seite neu/);

    /* PLAYS, present tense and scoped to THIS season. `/spielt/` alone matches inside „mitgespielt“,
       which says past seasons; the register says a club standing in the season applied for. */
    expect(fieldOf("bewerbung_picked_team_already_entered")).toMatch(/\bspielt\b/);
    expect(fieldOf("bewerbung_picked_team_already_entered")).toMatch(/dieser Saison/);
    expect(fieldOf("bewerbung_picked_team_already_entered")).not.toMatch(/beworben|Bewerbung|gespielt|früher|einmal/);
  });

  /* The record missing is a season the running API does not hold, which only a page from before a
     data reset names: the older page's sentence and reload, never the admin's „nicht gefunden“. */
  it("answers a missing season as the page gone stale", () => {
    expect(mapBewerbungSubmitRefusal(refused("document_not_found"))).toStrictEqual({ error: BEWERBUNG_VERALTET });
  });

  /* `READ-BEWERBUNG-001`: these two answer an anonymous caller, so neither may disclose that a club
     exists or its state. The vocabulary is the teams list's status facet, so a status added there is
     covered here too. */
  it("keeps both roster-facing refusals free of every status word the app uses", () => {
    const statuses = (TEAM_FACETS.find((facet) => facet.param === "status")?.options ?? []).map((option) => option.label);

    assert.ok(statuses.length > 0, "no status vocabulary was read, so this test compares nothing");

    // Beyond the table: words that disclose a club's existence or its past without naming a status.
    const telltale = [...statuses, "existiert", "gibt es", "früher", "ehemalig", "gelöscht", "removed", "reaktiv"];

    for (const code of ["bewerbung_picked_team_unusable"] as const) {
      const refusalText = Object.values(mapBewerbungSubmitRefusal(refused(code))?.fieldErrors ?? {}).join(" ");

      for (const numberWord of telltale) {
        assert.ok(!refusalText.toLowerCase().includes(numberWord.toLowerCase()), `${code} discloses roster state with „${numberWord}“`);
      }
    }
  });

  /* Naming no field, the 422 refused the body's shape, so the answer names no box. Every body rule the
     form can break is mirrored: this is a drifted client, whose remedy is a reload, not „Versuche es
     erneut“. */
  /* A body the API could not read at all is the same drifted client, and a retry sends the same bytes. */
  it("answers a body the API could not read as a body refusal naming no field", () => {
    const unreadable = mapBewerbungSubmitRefusal(refused("body_unreadable"));

    expect(unreadable, "the unreadable body falls through to the shared handler's retry").not.toBe(null);
    expect(unreadable).toStrictEqual(mapBewerbungSubmitRefusal(refusedPayload([], "/bewerbungen")));
  });

  it("answers a body refusal naming no field without sending the applicant to a box", () => {
    const mappedRefusal = mapBewerbungSubmitRefusal(refusedPayload([], "/bewerbungen"));

    expect(mappedRefusal, "a 422 falls through to the shared handler").not.toBe(null);
    expect(mappedRefusal?.fieldErrors, "a refusal naming no field landed on one anyway").toBe(undefined);

    // Every box the form owns: a refusal that cannot know which one broke may point at none of them.
    for (const box of ["Telefon", "E-Mail", "Vorname", "Nachname", "Geburtsdatum", "Kader", "Trikot", "Kürzel"]) {
      expect(mappedRefusal?.error ?? "", `the answer sends the applicant to „${box}“`).not.toMatch(new RegExp(box));
    }

    expect(mappedRefusal?.error ?? "", "the answer offers no way out of a stale client").toMatch(/Seite neu/);
  });

  // The reload rides beside the map: a path such as the contact block's own is one no control renders.
  it("puts a body refusal naming a field on that field's box, with the reload for a box the form lacks", () => {
    const mappedRefusal = mapBewerbungSubmitRefusal(
      refusedPayload([bodyField(["kontakte", "ansprechperson", "email"], "value_error")], "/bewerbungen"),
    );

    expect(mappedRefusal).toStrictEqual({
      fieldErrors: { "kontakte.ansprechperson.email": FELD_ABGELEHNT },
      unplacedError: mapBewerbungSubmitRefusal(refusedPayload([], "/bewerbungen"))?.error,
    });
  });
});
