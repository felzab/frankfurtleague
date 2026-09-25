import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseDate } from "@internationalized/date";

import { BESTAETIGUNG_KENNTNISNAHME } from "@/core/einwilligung";
import { APIBadStatusError } from "@/core/errors";
import { TEAM_FACETS } from "@/features/teams/facets";
import { answerShown, publishedRefusals, refusedOn } from "@/shared/testing/publishedRefusals.ts";
import { bodyField, refusedPayload } from "@/shared/testing/refusedPayload.ts";
import { FELD_ABGELEHNT } from "@/shared/utils/actionError";
import { getGermanTodayStr } from "@/shared/utils/date";
import { ANTWORT_NEU_OEFFNEN } from "@/shared/utils/reopenLink";

import { alterAusserhalb, BEWERBUNG_MAX_ALTER, BEWERBUNG_MIN_ALTER, VERTRETUNG_MIN_ALTER } from "./constants.ts";
import { buildEinwilligungAntwortPayloadSchema } from "./schemas.ts";
import {
  abiJahrgang,
  BEWERBUNG_VERALTET,
  bewerbungHerkunft,
  bewerbungJudgedPaths,
  bewerbungTeamName,
  buildBewerbungRows,
  describeAufnahme,
  empfangsSitze,
  fensterZustand,
  geburtsdatumSpanne,
  KUERZEL_PRUEFUNG,
  KUERZEL_UNGEPRUEFT,
  KUERZEL_VERGEBEN,
  kuerzelHinweis,
  mapBewerbungSubmitRefusal,
  mapEinwilligungAnsichtRefusal,
  mapEinwilligungRefusal,
  mirrorBewerbungTrainer,
  nenntLaufendeFassung,
} from "./utils.ts";

import type { FLBewerbung, FLBewerbungFensterResponse } from "./schemas.ts";
import type { BewerbungKontakteDraft, BewerbungKontaktpersonDraft } from "./types.ts";

/** The proposed school, of which only `team_name` decides the answer. */
const SCHOOL: FLBewerbung["schule"] = {
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
    const named = bewerbungTeamName({ schule: SCHOOL, team_id: null }, TEAMS);

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

describe("which of the two an application asks the league to enter", () => {
  it("is a new school where it proposes one", () => {
    assert.equal(bewerbungHerkunft({ schule: SCHOOL, team_id: null }), "neue_schule");
  });

  it("is an existing club where it picked one", () => {
    assert.equal(bewerbungHerkunft({ schule: null, team_id: "6890a1b2c3d4e5f607190002" }), "bestehendes_team");
  });

  /* An acceptance writes the created club's id back beside the school, so a decided new school carries
     both; asking the id first files it as a club that was already in the league. */
  it("stays a new school once the acceptance has named the club it created", () => {
    assert.equal(bewerbungHerkunft({ schule: SCHOOL, team_id: "6890a1b2c3d4e5f607190002" }), "neue_schule");
  });

  /* The row `REQ-BEWERBUNG-002` refuses. Any answer but none here is a badge, a filter option and a
     panel title each claiming a club or a school the application never named. */
  it("is neither where the application names neither", () => {
    assert.equal(bewerbungHerkunft({ schule: null, team_id: null }), null);
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
    schule: SCHOOL,
    kontakte: { trainer: null, ansprechperson: null, stellvertretung: null, trainer_ist_zugleich: null },
    trikot: { vorhandener_satz: "12 rote Trikots", wunschfarbe: null },
    kader: { voraussichtliche_groesse: 14, gute_spieler: 3 },
    stufengroesse: null,
    wunschgegner: null,
    entscheidung: null,
    bestaetigungen: null,
    bestaetigungsfrist: null,
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

describe("which state the window puts the page in", () => {
  const fenster = (overrides: Partial<FLBewerbungFensterResponse> = {}): FLBewerbungFensterResponse => ({
    acknowledged: 1,
    saison_id: "2627",
    offen: true,
    von: "2026-05-01",
    bis: "2026-07-31",
    laeuft: false,
    saison_beendet: false,
    ...overrides,
  });

  /* `laeuft` is the server's whole judgement against a clock this page does not share. Re-derived
     here, the page would offer the form for as long as the two clocks disagree. */
  it("takes the running answer from the server and never re-derives it", () => {
    assert.equal(fensterZustand(fenster({ laeuft: true }), "2020-01-01"), "laeuft");
    assert.equal(fensterZustand(fenster({ laeuft: true, offen: false }), "2099-01-01"), "laeuft");
  });

  /* Each closed answer is a different sentence: one says when to come back, one that the season is
     done, one that the league shut it. Folded together, a school goes away for the wrong reason. */
  it("separates a window that has not opened from one that is over", () => {
    assert.equal(fensterZustand(fenster(), "2026-04-30"), "noch-nicht");
    assert.equal(fensterZustand(fenster(), "2026-08-01"), "vorbei");
  });

  /* Shut by the league rather than by a date, so neither date answer is true of it: nothing has run
     out, and nothing opens on a day this window names. */
  it("reads a window the league closed as closed, whatever the dates say", () => {
    assert.equal(fensterZustand(fenster({ offen: false }), "2026-04-30"), "geschlossen");
    assert.equal(fensterZustand(fenster({ offen: false }), "2026-06-01"), "geschlossen");
    assert.equal(fensterZustand(fenster({ offen: false }), "2026-08-01"), "geschlossen");
  });

  /* `laeuft` false inside an open span is this clock disagreeing with the server's. Answered
     `vorbei`, the page would state a deadline nobody has reached. */
  it("never says a deadline passed while today is still inside the span", () => {
    assert.equal(fensterZustand(fenster(), "2026-06-01"), "geschlossen");
  });

  /* A season taking no applications at all is its own answer. The page still renders — a school
     arriving on last year's link has a question, and a 404 answers none of it. */
  it("reads a season with no window as its own state rather than as expired", () => {
    assert.equal(fensterZustand(null, "2026-06-01"), "keine-frist");
  });

  /* An ended season takes no application again, so every date answer would send a school to wait
     for a window that never reopens: the span still running, the league's switch off, a span not
     yet begun. */
  it("reads every window of a season that has ended as over, whatever its dates and its switch say", () => {
    assert.equal(fensterZustand(fenster({ saison_beendet: true }), "2026-06-01"), "vorbei");
    assert.equal(fensterZustand(fenster({ saison_beendet: true, offen: false }), "2026-06-01"), "vorbei");
    assert.equal(fensterZustand(fenster({ saison_beendet: true }), "2026-04-30"), "vorbei");
  });
});

describe("the Abi-Jahrgang a season fields", () => {
  /* The season the league actually holds. Read as two halves of a school year, `2026` answers 2021:
     five years past, on the one banner this page exists to carry. */
  it("is the year after the calendar year the id spells", () => {
    assert.equal(abiJahrgang("2026"), "2027");
  });

  /* Every fixture a school-year reading and a calendar one answer differently, which is what the
     single case above cannot be on its own: a fixture the two agree on proves neither. */
  it("reads the whole id as the year, never its first two digits", () => {
    assert.equal(abiJahrgang("2027"), "2028");
    assert.equal(abiJahrgang("2030"), "2031");
    // A century boundary falls out of the arithmetic rather than out of a `20` prefix.
    assert.equal(abiJahrgang("2099"), "2100");
  });
});

describe("the birthdate window a contact person's date has to fall in", () => {
  /* The endpoint's own rule restated rather than its result quoted, so both bounds are judged
     against what it accepts: whole years, a birthday not yet reached this year not having happened
     (`fl_backend/app/shared/alter.py :: whole_years_between`). */
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
    assert.deepEqual(geburtsdatumSpanne("2026-08-29", BEWERBUNG_MIN_ALTER), { frueheste: "1905-08-30", spaeteste: "2010-08-29" });
  });

  /* The floor moves with the seat while the ceiling does not, so a derivation that read a constant
     for either would offer one seat a date the endpoint then refuses. */
  it("moves the floor's end with the seat and leaves the ceiling's where it is", () => {
    assert.deepEqual(geburtsdatumSpanne("2026-08-29", VERTRETUNG_MIN_ALTER), { frueheste: "1905-08-30", spaeteste: "2008-08-29" });
  });

  /* A 29 February has no counterpart in a year that is not a leap year, 1903 and 2100 among them, so
     an arithmetic that kept the day would hand the picker a date its own parse refuses. */
  it("clamps a leap day onto the end of February where the target year has none", () => {
    assert.deepEqual(geburtsdatumSpanne("2024-02-29", BEWERBUNG_MIN_ALTER), { frueheste: "1903-03-01", spaeteste: "2008-02-29" });
    assert.equal(geburtsdatumSpanne("2116-02-29", BEWERBUNG_MIN_ALTER).spaeteste, "2100-02-28");
  });

  /* Both tiers refuse the same set. A band the page turns away and the endpoint accepts is a
     contact person told to correct a date that was right. */
  it("ends both bounds exactly where the endpoint's whole-year count does, at either floor", () => {
    for (const mindestalter of [BEWERBUNG_MIN_ALTER, VERTRETUNG_MIN_ALTER]) {
      for (const today2 of ["2026-09-04", "2024-02-29", "2027-03-01", "2116-02-29"]) {
        const { frueheste, spaeteste } = geburtsdatumSpanne(today2, mindestalter);
        const wo = `${today2} at ${String(mindestalter)}`;

        assert.equal(wholeYears(frueheste, today2), BEWERBUNG_MAX_ALTER, `${wo}: the earliest date offered is not the oldest accepted`);
        assert.equal(wholeYears(previousDay(frueheste), today2), BEWERBUNG_MAX_ALTER + 1, `${wo}: the day before it is accepted too`);
        assert.equal(wholeYears(spaeteste, today2), mindestalter, `${wo}: the latest date offered is not the youngest accepted`);
        assert.equal(wholeYears(nextDay(spaeteste), today2), mindestalter - 1, `${wo}: the day after it is accepted too`);
      }
    }
  });

  /* The offer's other half, which the picker cannot show: the SCHEMA takes the latest date the
     control offers and refuses the day after it. On a module constant it does neither at eighteen. */
  it("accepts the latest date the control offers and refuses the day after it, at either floor", () => {
    for (const mindestalter of [BEWERBUNG_MIN_ALTER, VERTRETUNG_MIN_ALTER]) {
      const { spaeteste } = geburtsdatumSpanne(getGermanTodayStr(), mindestalter);
      const schema = buildEinwilligungAntwortPayloadSchema(mindestalter);
      const antwort = { token: "kein-echtes-token", antwort: "erteilt", whatsapp: false, text_version: BESTAETIGUNG_KENNTNISNAHME.textVersion };

      assert.equal(schema.safeParse({ ...antwort, geburtsdatum: spaeteste }).success, true, `${String(mindestalter)}: the offer is refused`);
      assert.equal(
        schema.safeParse({ ...antwort, geburtsdatum: nextDay(spaeteste) }).success,
        false,
        `${String(mindestalter)}: a day younger than the offer is accepted`,
      );
    }
  });
});

describe("which seats the submission's receipt answers for", () => {
  /* The mirrored seat is the same person on the same mailbox, and `paired_seat` lets either press
     answer both, so a link message for it asks one reader twice; the receipt that mailbox gets names
     both roles (`fl_frontend/src/features/bewerbungen/notifications.test.ts`). */
  it("withholds the Trainer seat only where it mirrors the Ansprechperson", () => {
    assert.deepEqual(empfangsSitze("ansprechperson"), ["ansprechperson", "trainer"]);
    assert.deepEqual(empfangsSitze("stellvertretung"), ["ansprechperson"]);
    assert.deepEqual(empfangsSitze(null), ["ansprechperson"]);
  });
});

describe("the public form's coach mirror", () => {
  const person = (vorname: string): BewerbungKontaktpersonDraft => ({
    vorname: vorname,
    nachname: "Mustermann",
    email: `${vorname.toLowerCase()}@beispiel.de`,
    telefon: "069 1234567",
    einwilligung: { text_version: "2026-08", erteilt: true },
  });

  const kontakte = (overrides: Partial<BewerbungKontakteDraft> = {}): BewerbungKontakteDraft => ({
    trainer: person("Tim"),
    ansprechperson: person("Erika"),
    stellvertretung: person("Lena"),
    trainer_ist_zugleich: null,
    ...overrides,
  });

  /* The direction is the whole of it, and the OPPOSITE of the admin editor's. Reversed, ticking the
     box would wipe the very person who was just declared to be the coach. */
  it("fills the Trainer seat from whichever seat declared itself the coach", () => {
    const mirroredPair = mirrorBewerbungTrainer(kontakte({ trainer_ist_zugleich: "ansprechperson" }));

    assert.equal(mirroredPair.trainer.vorname, "Erika");
    assert.equal(mirroredPair.trainer, mirroredPair.ansprechperson, "the two seats hold two records rather than one");
    assert.equal(mirroredPair.stellvertretung.vorname, "Lena", "a seat the claim does not name was overwritten");
  });

  it("fills it from the Stellvertretung where that seat is the one that declared itself", () => {
    const mirroredPair = mirrorBewerbungTrainer(kontakte({ trainer_ist_zugleich: "stellvertretung" }));

    assert.equal(mirroredPair.trainer.vorname, "Lena");
    assert.equal(mirroredPair.ansprechperson.vorname, "Erika");
  });

  it("moves nobody while the claim names nobody", () => {
    const mirroredPair = mirrorBewerbungTrainer(kontakte());

    assert.equal(mirroredPair.trainer.vorname, "Tim");
    assert.equal(mirroredPair.ansprechperson.vorname, "Erika");
  });
});

describe("which paths one judgement covers in the public form", () => {
  /* The declaring seat's boxes are the only ones the Trainer's copy can be edited through, so a
     judgement that skipped the copy would leave its verdict standing over what the seat replaced. */
  it("judges the Trainer's copy alongside every field of the seat that feeds it", () => {
    assert.deepEqual(bewerbungJudgedPaths(["kontakte.ansprechperson.email"], "ansprechperson"), [
      "kontakte.ansprechperson.email",
      "kontakte.trainer.email",
    ]);
    assert.deepEqual(bewerbungJudgedPaths(["kontakte.stellvertretung.telefon"], "stellvertretung"), [
      "kontakte.stellvertretung.telefon",
      "kontakte.trainer.telefon",
    ]);
  });

  it("reaches no second seat with an empty claim, and none from a seat the mirror does not feed", () => {
    assert.deepEqual(bewerbungJudgedPaths(["kontakte.ansprechperson.email"], null), ["kontakte.ansprechperson.email"]);
    assert.deepEqual(bewerbungJudgedPaths(["kontakte.stellvertretung.email"], "ansprechperson"), ["kontakte.stellvertretung.email"]);
    assert.deepEqual(bewerbungJudgedPaths(["team_id"], "ansprechperson"), ["team_id"]);
  });
});

/** The public write, spelled as the backend's own routes spell it. */
const SUBMIT_OPERATION = "POST /bewerbungen";
const CONFIRM_OPERATION = "POST /bewerbungen/einwilligung";
const ANSICHT_OPERATION = "POST /bewerbungen/einwilligung/ansicht";

/** One refusal as the client sees it: a 409 carrying the code, which is the whole of what it maps on. */
const badStatus = (statusCode: number, serverErrorCode: string) =>
  new APIBadStatusError({
    message: "refused",
    url: "http://backend/api/v0/bewerbungen",
    statusCode: statusCode,
    serverErrorCode: serverErrorCode,
    endpoint: "/bewerbungen",
    method: "POST",
    readOnly: false,
    traceId: "0123456789abcdef",
  });

/**
 * `code` as `operation` refuses with it, asserted published there first: an arm kept for a code the
 * backend stopped publishing fails here rather than passing on a refusal nothing sends.
 */
function publishedOn(operation: string, code: string) {
  assert.ok(publishedRefusals(operation).includes(code), `${code} is no longer published on ${operation}`);

  return refusedOn(operation, code);
}

describe("what a submission's refusal is shown as", () => {
  const refusal = (code: string) => mapBewerbungSubmitRefusal(publishedOn(SUBMIT_OPERATION, code));

  /* Asserted before the arms below: a mapper that stopped recognising a 409 at all would return
     `null` everywhere, and every "names no field" assertion would pass over nothing. */
  it("recognises the submission's own codes at all", () => {
    for (const code of ["REQ-BEWERBUNG-004", "REQ-BEWERBUNG-005", "REQ-BEWERBUNG-006", "REQ-BEWERBUNG-007", "REQ-BEWERBUNG-008"]) {
      assert.notEqual(refusal(code), null, `${code} reaches the applicant unmapped`);
    }
  });

  // The mark the form titles by: the application arrived, so „nicht abgeschickt“ would be false.
  it("marks the repeated press's refusal as arrived, and no other refusal", () => {
    assert.equal(refusal("REQ-BEWERBUNG-015")?.schonAngekommen, true);
    for (const code of ["REQ-BEWERBUNG-004", "REQ-BEWERBUNG-005", "REQ-BEWERBUNG-006", "REQ-BEWERBUNG-007", "REQ-BEWERBUNG-008"]) {
      assert.equal(refusal(code)?.schonAngekommen, undefined, code);
    }
  });

  /* A refusal naming a field has to land under the control at fault: as a toast it names a box the
     applicant then has to find, and this form has dozens of them. */
  it("puts each field refusal on the path its own input renders", () => {
    assert.deepEqual(Object.keys(refusal("REQ-BEWERBUNG-005")?.fieldErrors ?? {}), ["team_id"]);
    assert.deepEqual(Object.keys(refusal("REQ-BEWERBUNG-006")?.fieldErrors ?? {}), ["team_id"]);
    assert.deepEqual(Object.keys(refusal("REQ-BEWERBUNG-007")?.fieldErrors ?? {}), ["team_id"]);
    assert.deepEqual(Object.keys(refusal("REQ-BEWERBUNG-008")?.fieldErrors ?? {}), ["schule.shorthand"]);
  });

  /* The window closing mid-form is about the season rather than about anything typed, so it has no
     field to sit on and a reload is the whole remedy. */
  it("reports a closed window as a banner with no field on it", () => {
    assert.equal(refusal("REQ-BEWERBUNG-004")?.fieldErrors, undefined);
    assert.match(refusal("REQ-BEWERBUNG-004")?.error ?? "", /Lade die Seite neu/);
  });

  /* The one answer a taken Kürzel gets, wherever it is judged: the blur-time check and this refusal
     word it from the same constant, so the two cannot come to disagree. */
  it("gives a taken Kürzel the same neutral sentence the blur check gives", () => {
    assert.equal(refusal("REQ-BEWERBUNG-008")?.fieldErrors?.["schule.shorthand"], KUERZEL_VERGEBEN);
    assert.ok(!KUERZEL_VERGEBEN.includes("stillgelegt"), "the answer separates a retired club from an active one");
  });

  it("maps nothing it does not recognise, so an unknown code falls through to the shared handler", () => {
    assert.equal(mapBewerbungSubmitRefusal(refusedOn(SUBMIT_OPERATION, "REQ-BEWERBUNG-999", 409)), null);
    assert.equal(mapBewerbungSubmitRefusal(new Error("boom")), null);
    // A write answered with a 5xx may have landed, which no refusal's words may deny.
    assert.equal(mapBewerbungSubmitRefusal(badStatus(500, "REQ-BEWERBUNG-005")), null);
  });

  /* Codes are unique across the API, so a rule moved to another status keeps its answer. */
  it("answers a code alike at whatever status its rule answers with", () => {
    for (const code of ["REQ-BEWERBUNG-005", "REQ-BEWERBUNG-015"]) {
      assert.deepEqual(mapBewerbungSubmitRefusal(badStatus(422, code)), refusal(code), code);
    }
  });
});

describe("the submission's refusals against the codes its endpoint publishes", () => {
  /* The one class a unit test here CAN hold: a published code this maps nowhere reaches the applicant
     as the generic sentence, which names no field and no way out. */
  it("maps every code the submission publishes", () => {
    for (const code of publishedRefusals(SUBMIT_OPERATION)) {
      assert.notEqual(answerShown(SUBMIT_OPERATION, code, mapBewerbungSubmitRefusal), null, `${code} reaches the applicant unmapped`);
    }
  });

  /* One code, one answer. Sharing one sentence between two of them is the failure this catches:
     each names a different thing to change, and a reader given the wrong one changes the wrong box. */
  it("gives each code its own answer", () => {
    const answers = publishedRefusals(SUBMIT_OPERATION).map((code) =>
      JSON.stringify(mapBewerbungSubmitRefusal(refusedOn(SUBMIT_OPERATION, code))),
    );

    assert.equal(new Set(answers).size, answers.length, "two codes are answered with the same sentence");
  });

  /* Distinct is not the same as TRUE, which is all the case above can see. „Schon beworben“ and
     „spielt schon mit“ are two readings a German sentence separates and no structural check does —
     and only one is what the backend refuses. */
  it("says of each code what the backend constant it answers refuses", () => {
    const fieldOf = (code: string) =>
      Object.values(mapBewerbungSubmitRefusal(publishedOn(SUBMIT_OPERATION, code))?.fieldErrors ?? {}).join(" ");
    const banner = (code: string) => mapBewerbungSubmitRefusal(publishedOn(SUBMIT_OPERATION, code))?.error ?? "";

    // The season stopped taking applications; nothing about the school is at fault.
    assert.match(banner("REQ-BEWERBUNG-004"), /keine Bewerbungen/);
    assert.doesNotMatch(banner("REQ-BEWERBUNG-004"), /Schule|Kürzel/);

    // Both-or-neither: the answer is the choice itself, not a clash with anything stored.
    assert.match(fieldOf("REQ-BEWERBUNG-005"), /entweder/);
    assert.match(fieldOf("REQ-BEWERBUNG-005"), /oder/);

    /* The picker never offered this club, so a reload is the primary repair; the new-school arm is an
       alternative and has to carry the free-Kürzel qualifier, or it promises a path `-008` refuses. */
    assert.match(fieldOf("REQ-BEWERBUNG-006"), /[Ll]ade die Seite neu/);
    assert.match(fieldOf("REQ-BEWERBUNG-006"), /frei\w* Kürzel/);

    /* PLAYS, present tense and scoped to THIS season. `/spielt/` alone matches inside „mitgespielt“,
       which says past seasons; the register says a club standing in the season applied for. */
    assert.match(fieldOf("REQ-BEWERBUNG-007"), /\bspielt\b/);
    assert.match(fieldOf("REQ-BEWERBUNG-007"), /dieser Saison/);
    assert.doesNotMatch(fieldOf("REQ-BEWERBUNG-007"), /beworben|Bewerbung|gespielt|früher|einmal/);

    // An earlier wording on a seat is a page older than the deploy, which a reload replaces: the
    // sentence the form's own parse gives such a page, and no box, none of them being at fault.
    assert.deepEqual(mapBewerbungSubmitRefusal(publishedOn(SUBMIT_OPERATION, "REQ-BEWERBUNG-016")), { error: BEWERBUNG_VERALTET });
  });

  /* `READ-BEWERBUNG-001`: these two answer an anonymous caller, so neither may disclose that a club
     exists or its state. The vocabulary is the teams list's status facet, so a status added there is
     covered here too. */
  it("keeps both roster-facing refusals free of every status word the app uses", () => {
    const statuses = (TEAM_FACETS.find((facet) => facet.param === "status")?.options ?? []).map((option) => option.label);

    assert.ok(statuses.length > 0, "no status vocabulary was read, so this test compares nothing");

    // Beyond the table: words that disclose a club's existence or its past without naming a status.
    const telltale = [...statuses, "existiert", "gibt es", "früher", "ehemalig", "gelöscht", "entfernt", "reaktiv"];

    for (const code of ["REQ-BEWERBUNG-006", "REQ-BEWERBUNG-008"]) {
      const refusalText = Object.values(mapBewerbungSubmitRefusal(publishedOn(SUBMIT_OPERATION, code))?.fieldErrors ?? {}).join(" ");

      for (const numberWord of telltale) {
        assert.ok(!refusalText.toLowerCase().includes(numberWord.toLowerCase()), `${code} discloses roster state with „${numberWord}“`);
      }
    }
  });

  /* Naming no field, the 422 refused the body's shape, so the answer names no box. Every body rule the
     form can break is mirrored: this is a drifted client, whose remedy is a reload, not „Versuche es
     erneut“. */
  it("answers a body refusal naming no field without sending the applicant to a box", () => {
    const mappedRefusal = mapBewerbungSubmitRefusal(refusedPayload([], "/bewerbungen"));

    assert.notEqual(mappedRefusal, null, "a 422 falls through to the shared handler");
    assert.equal(mappedRefusal?.fieldErrors, undefined, "a refusal naming no field landed on one anyway");

    // Every box the form owns: a refusal that cannot know which one broke may point at none of them.
    for (const box of ["Telefon", "E-Mail", "Vorname", "Nachname", "Geburtsdatum", "Kader", "Trikot", "Kürzel"]) {
      assert.doesNotMatch(mappedRefusal?.error ?? "", new RegExp(box), `the answer sends the applicant to „${box}“`);
    }

    assert.match(mappedRefusal?.error ?? "", /Seite neu/, "the answer offers no way out of a stale client");
  });

  // The reload rides beside the map: a path such as the contact block's own is one no control renders.
  it("puts a body refusal naming a field on that field's box, with the reload for a box the form lacks", () => {
    const mappedRefusal = mapBewerbungSubmitRefusal(
      refusedPayload([bodyField(["kontakte", "ansprechperson", "email"], "value_error")], "/bewerbungen"),
    );

    assert.deepEqual(mappedRefusal, {
      fieldErrors: { "kontakte.ansprechperson.email": FELD_ABGELEHNT },
      unplacedError: mapBewerbungSubmitRefusal(refusedPayload([], "/bewerbungen"))?.error,
    });
  });
});

describe("what the blur-time Kürzel check says short of a refusal", () => {
  const verdictOf = (shorthand: string, vergeben: boolean) => ({ shorthand: shorthand, vergeben: vergeben });

  /* Nothing to say about a code nobody has finished typing: a line under a half-typed box describes
     a value the check was never asked about. */
  it("says nothing about an incomplete code", () => {
    assert.equal(kuerzelHinweis("", null, false), null);
    assert.equal(kuerzelHinweis("G", null, true), null);
  });

  /* Its own line, not the unjudged one: both mention checking, and a reader told „beim Abschicken“
     while a request is out learns nothing about the request that is out. */
  it("says that it is checking while the request is out", () => {
    assert.equal(kuerzelHinweis("GG", null, true), KUERZEL_PRUEFUNG);
    assert.notEqual(KUERZEL_PRUEFUNG, KUERZEL_UNGEPRUEFT);
  });

  /* The arm a rate limit, a dropped connection and a fresh keystroke all land in. Silent, a school
     reads „noch frei“ from the last code it typed and finds out at the submit. */
  it("says the code is unjudged where no verdict covers the value in the box", () => {
    assert.equal(kuerzelHinweis("GG", null, false), KUERZEL_UNGEPRUEFT);
    assert.equal(kuerzelHinweis("GG", verdictOf("GY", false), false), KUERZEL_UNGEPRUEFT);
    assert.equal(kuerzelHinweis("GG", verdictOf("GY", true), false), KUERZEL_UNGEPRUEFT);
  });

  it("confirms a free code, and leaves a taken one to the field error", () => {
    assert.match(kuerzelHinweis("GG", verdictOf("GG", false), false) ?? "", /noch frei/);
    assert.equal(kuerzelHinweis("GG", verdictOf("GG", true), false), null);
  });
});

describe("the confirmation's refusals against the codes its endpoint publishes", () => {
  /* A published code this maps nowhere reaches the contact person as a bare „Antwort nicht gespeichert“
     toast, which names neither the field to fix nor the panel that would explain the dead link. */
  it("maps every code the confirmation publishes", () => {
    for (const code of publishedRefusals(CONFIRM_OPERATION)) {
      const answered = answerShown(CONFIRM_OPERATION, code, (error) => mapEinwilligungRefusal(error, VERTRETUNG_MIN_ALTER));
      assert.notEqual(answered, null, `${code} reaches the contact person unmapped`);
    }
  });

  /* The link's own read answers every refusal alike: a spent link answers its state in a 200, so a
     refusal is a token nothing could place. */
  it("calls the link void on every refusal its read publishes", () => {
    for (const code of publishedRefusals(ANSICHT_OPERATION)) {
      assert.equal(mapEinwilligungAnsichtRefusal(refusedOn(ANSICHT_OPERATION, code)), "ungueltig", code);
    }
  });

  /* Each code names a different thing: three dead-link panels and one field. Two sharing an answer
     is a reader sent to the wrong one of the two, with no way to tell. */
  it("gives each code its own answer", () => {
    const answers = publishedRefusals(CONFIRM_OPERATION).map((code) =>
      JSON.stringify(mapEinwilligungRefusal(refusedOn(CONFIRM_OPERATION, code), VERTRETUNG_MIN_ALTER)),
    );

    assert.equal(new Set(answers).size, answers.length, "two codes are answered with the same panel or sentence");
  });

  /* One code covers a confirmation and a decline alike, so a state picked here tells a seat that
     declined in another window that it confirmed. Which way it went is the ansicht read's to say. */
  it("asks its caller to read the already-answered link rather than naming a state", () => {
    const mappedRefusal = mapEinwilligungRefusal(publishedOn(CONFIRM_OPERATION, "REQ-BEWERBUNG-011"), VERTRETUNG_MIN_ALTER);

    assert.equal(mappedRefusal?.nachlesen, true, "the already-answered refusal no longer asks for the read");
    assert.equal(mappedRefusal?.zustand, undefined, "one code picked a panel it has no way to tell from the other");
    assert.equal(mappedRefusal?.fieldErrors, undefined, "a refusal that spends the token landed on the form's one field");
  });

  /* The age refusal spends no token, so it has to land on the one field the page renders: a `zustand`
     here would replace a live form with a dead-link panel and lose the date the person typed. */
  it("answers the age refusal at the field, naming the floor it was given and never a state", () => {
    for (const floor of [BEWERBUNG_MIN_ALTER, VERTRETUNG_MIN_ALTER]) {
      const mappedRefusal = mapEinwilligungRefusal(publishedOn(CONFIRM_OPERATION, "REQ-BEWERBUNG-012"), floor);
      const gesagt = mappedRefusal?.fieldErrors?.geburtsdatum ?? "";

      assert.equal(mappedRefusal?.zustand, undefined, "a refusal the token survives closed the form anyway");
      assert.ok(gesagt.includes(String(floor)), `the sentence does not name ${String(floor)}, which is the floor it was handed`);
    }
  });

  /* The floor-aware half, which the page states because it knows the seat: a sentence carrying one
     floor at both seats tells a refused Ansprechperson their date cleared the bar. */
  it("names the floor it was given, and the ceiling either way", () => {
    for (const floor of [BEWERBUNG_MIN_ALTER, VERTRETUNG_MIN_ALTER]) {
      const gesagt = alterAusserhalb(floor);

      assert.ok(gesagt.includes(String(floor)), `the sentence for ${String(floor)} does not name it`);
      assert.ok(gesagt.includes(String(BEWERBUNG_MAX_ALTER)), "a mistyped century is answered with the floor alone");
    }
  });

  /* Naming no field, a drifted client, since every body rule the panel can break is mirrored: the
     answer names no box, nothing here knowing which one broke, and reopens the mail's link, the page
     having stripped its token. */
  it("answers a body refusal naming no field with the mail's link, pointing at no field", () => {
    const mappedRefusal = mapEinwilligungRefusal(refusedPayload([], "/bewerbungen"), VERTRETUNG_MIN_ALTER);

    assert.deepEqual(mappedRefusal, { error: ANTWORT_NEU_OEFFNEN });
  });

  it("puts a body refusal naming a field on that field's box, with the mail's link for a box the panel lacks", () => {
    const mappedRefusal = mapEinwilligungRefusal(
      refusedPayload([bodyField(["geburtsdatum"], "date_from_datetime_parsing")], "/bewerbungen"),
      VERTRETUNG_MIN_ALTER,
    );

    assert.deepEqual(mappedRefusal, { fieldErrors: { geburtsdatum: FELD_ABGELEHNT }, unplacedError: ANTWORT_NEU_OEFFNEN });
  });
});

describe("which wording an answer may be stored under", () => {
  const GESENDET = { token: "kein-echtes-token", antwort: "erteilt", geburtsdatum: "1984-05-09", whatsapp: false };

  /* The label names which words were on screen, and only this server knows which it renders now: a
     body's own label is a claim, admitted only where it is that one. */
  it("admits the label this server renders and no other", () => {
    assert.equal(
      nenntLaufendeFassung({ ...GESENDET, text_version: BESTAETIGUNG_KENNTNISNAHME.textVersion }, BESTAETIGUNG_KENNTNISNAHME.textVersion),
      true,
    );
    assert.equal(nenntLaufendeFassung({ ...GESENDET, text_version: "2019-01-erfunden" }, BESTAETIGUNG_KENNTNISNAHME.textVersion), false);
    assert.equal(nenntLaufendeFassung(GESENDET, BESTAETIGUNG_KENNTNISNAHME.textVersion), false, "a body naming no label is admitted");
    assert.equal(nenntLaufendeFassung(null, BESTAETIGUNG_KENNTNISNAHME.textVersion), false);
  });
});

describe("mapEinwilligungAnsichtRefusal", () => {
  /* The read refuses an unknown token alone; a spent, declined or expired link answers its own
     `zustand` in a 200. Fail-closed, so a code nobody planned still renders the panel naming nobody. */
  it("reads every refusal as the panel that names nobody", () => {
    assert.equal(mapEinwilligungAnsichtRefusal(publishedOn(ANSICHT_OPERATION, "REQ-BEWERBUNG-009")), "ungueltig");
    for (const status of [409, 404, 410]) {
      assert.equal(mapEinwilligungAnsichtRefusal(refusedOn(ANSICHT_OPERATION, "REQ-SOMETHING-NEW", status)), "ungueltig", String(status));
    }
  });

  /* A token past `CustomBewerbungToken`'s length, or malformed, never reaches a record, so the read
     is answered by the dead-link panel rather than by the state inviting a reload that cannot work. */
  it("reads a token the backend will not parse as a link nothing matches", () => {
    assert.equal(mapEinwilligungAnsichtRefusal(refusedPayload([], "/bewerbungen")), "ungueltig");
  });

  /* A failed read is the page's own state: answering „ungueltig“ on a 500 would call a live link
     void on a day the backend was unreachable. */
  it("leaves anything that is not a refusal to the caller", () => {
    assert.equal(mapEinwilligungAnsichtRefusal(badStatus(500, "")), null);
    assert.equal(mapEinwilligungAnsichtRefusal(new Error("socket hang up")), null);
  });
});
