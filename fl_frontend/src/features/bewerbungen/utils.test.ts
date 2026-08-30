import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { APIBadStatusError } from "@/core/errors";

import { declaredCodes } from "../../core/refusalRegister.ts";
import {
  abiJahrgang,
  bewerbungJudgedPaths,
  bewerbungTeamName,
  buildBewerbungRows,
  describeAufnahme,
  fensterZustand,
  geburtsdatumSpanne,
  KUERZEL_PRUEFUNG,
  KUERZEL_UNGEPRUEFT,
  KUERZEL_VERGEBEN,
  kuerzelHinweis,
  mapBewerbungSubmitRefusal,
  mirrorBewerbungTrainer,
} from "./utils.ts";

import type { FLBewerbung, FLBewerbungFensterResponse } from "./schemas.ts";
import type { BewerbungKontakteDraft, BewerbungKontaktpersonDraft } from "./types.ts";

const SRC_DIR = path.resolve(import.meta.dirname, "..", "..");

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
    kontakte: { trainer: null, ansprechperson: null, stellvertretung: null, trainer_ist_zugleich: null },
    trikot: { vorhandener_satz: "12 rote Trikots", wunschfarbe: null },
    kader: { voraussichtliche_groesse: 14, gute_spieler: 3 },
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

describe("which state the window puts the page in", () => {
  const fenster = (overrides: Partial<FLBewerbungFensterResponse> = {}): FLBewerbungFensterResponse => ({
    acknowledged: 1,
    saison_id: "2627",
    offen: true,
    von: "2026-05-01",
    bis: "2026-07-31",
    laeuft: false,
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
  /* Bounds and not an age: the picker needs a `minValue` and a `maxValue`, the schema needs a string
     comparison, and one derivation serving both is what stops the two drifting apart. */
  it("spans both bounds off today, and both ends are inclusive", () => {
    assert.deepEqual(geburtsdatumSpanne("2026-08-29"), { frueheste: "1906-08-29", spaeteste: "2010-08-29" });
  });

  /* Both bounds are multiples of four years, so a 29 February lands on a leap year either way — a
     date arithmetic that produced 30 February would be refused by the picker's own parse. */
  it("lands a leap day on a leap year at both ends", () => {
    assert.deepEqual(geburtsdatumSpanne("2024-02-29"), { frueheste: "1904-02-29", spaeteste: "2008-02-29" });
  });
});

describe("the public form's coach mirror", () => {
  const person = (vorname: string): BewerbungKontaktpersonDraft => ({
    vorname: vorname,
    nachname: "Mustermann",
    email: `${vorname.toLowerCase()}@beispiel.de`,
    telefon: "069 1234567",
    geburtsdatum: "1990-01-01",
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
    const gespiegelt = mirrorBewerbungTrainer(kontakte({ trainer_ist_zugleich: "ansprechperson" }));

    assert.equal(gespiegelt.trainer.vorname, "Erika");
    assert.equal(gespiegelt.trainer, gespiegelt.ansprechperson, "the two seats hold two records rather than one");
    assert.equal(gespiegelt.stellvertretung.vorname, "Lena", "a seat the claim does not name was overwritten");
  });

  it("fills it from the Stellvertretung where that seat is the one that declared itself", () => {
    const gespiegelt = mirrorBewerbungTrainer(kontakte({ trainer_ist_zugleich: "stellvertretung" }));

    assert.equal(gespiegelt.trainer.vorname, "Lena");
    assert.equal(gespiegelt.ansprechperson.vorname, "Erika");
  });

  it("moves nobody while the claim names nobody", () => {
    const gespiegelt = mirrorBewerbungTrainer(kontakte());

    assert.equal(gespiegelt.trainer.vorname, "Tim");
    assert.equal(gespiegelt.ansprechperson.vorname, "Erika");
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
    assert.deepEqual(bewerbungJudgedPaths(["kontakte.stellvertretung.geburtsdatum"], "stellvertretung"), [
      "kontakte.stellvertretung.geburtsdatum",
      "kontakte.trainer.geburtsdatum",
    ]);
  });

  it("reaches no second seat with an empty claim, and none from a seat the mirror does not feed", () => {
    assert.deepEqual(bewerbungJudgedPaths(["kontakte.ansprechperson.email"], null), ["kontakte.ansprechperson.email"]);
    assert.deepEqual(bewerbungJudgedPaths(["kontakte.stellvertretung.email"], "ansprechperson"), ["kontakte.stellvertretung.email"]);
    assert.deepEqual(bewerbungJudgedPaths(["team_id"], "ansprechperson"), ["team_id"]);
  });
});

/** The public write, spelled as `fl_backend/app/core/domain.py` spells the operation it declares. */
const SUBMIT_OPERATION = "POST /bewerbungen";

/** One refusal as the client sees it: a 409 carrying the code, which is the whole of what it maps on. */
const badStatus = (statusCode: number, serverErrorCode: string) =>
  new APIBadStatusError({
    message: "refused",
    url: "http://backend/api/v0/bewerbungen",
    statusCode: statusCode,
    serverErrorCode: serverErrorCode,
    endpoint: "/bewerbungen",
    correlationId: "0123456789abcdef",
  });

const refusalFor = (code: string) => badStatus(409, code);

describe("what a submission's refusal is shown as", () => {
  const refusal = (code: string) => mapBewerbungSubmitRefusal(refusalFor(code));

  /* Asserted before the arms below: a mapper that stopped recognising a 409 at all would return
     `null` everywhere, and every "names no field" assertion would pass over nothing. */
  it("recognises the submission's own codes at all", () => {
    for (const code of ["REQ-BEWERBUNG-004", "REQ-BEWERBUNG-005", "REQ-BEWERBUNG-006", "REQ-BEWERBUNG-007", "REQ-BEWERBUNG-008"]) {
      assert.notEqual(refusal(code), null, `${code} reaches the applicant unmapped`);
    }
  });

  /* A refusal naming a field has to land under the control at fault: as a toast it names a box the
     applicant then has to find, and this form has thirty of them. */
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
    assert.equal(refusal("REQ-BEWERBUNG-999"), null);
    assert.equal(mapBewerbungSubmitRefusal(new Error("boom")), null);
    assert.equal(mapBewerbungSubmitRefusal(badStatus(404, "REQ-BEWERBUNG-005")), null);
  });
});

describe("the submission's refusals against the backend's register", () => {
  /* Before every comparison below: a loop over an operation the register no longer names runs zero
     times and proves nothing. An empty list here is the harness failing, not the source. */
  it("finds rules declared against the submission at all", () => {
    assert.ok(declaredCodes(SUBMIT_OPERATION).length > 0, `no rule is declared against ${SUBMIT_OPERATION}`);
  });

  /* The one class a unit test here CAN hold: a declared code this maps nowhere reaches the applicant
     as the generic sentence, which names no field and no way out. */
  it("maps every code the submission declares", () => {
    const mapped = declaredCodes(SUBMIT_OPERATION).filter((code) => mapBewerbungSubmitRefusal(refusalFor(code)) !== null);

    assert.deepEqual(mapped, declaredCodes(SUBMIT_OPERATION));
  });

  /* Five codes, five answers. Sharing one sentence between two of them is the failure this catches:
     each names a different thing to change, and a reader given the wrong one changes the wrong box. */
  it("gives each code its own answer", () => {
    const answers = declaredCodes(SUBMIT_OPERATION).map((code) => JSON.stringify(mapBewerbungSubmitRefusal(refusalFor(code))));

    assert.equal(new Set(answers).size, answers.length, "two codes are answered with the same sentence");
  });

  /* Distinct is not the same as TRUE, which is all the case above can see. „Schon beworben“ and
     „spielt schon mit“ are two readings a German sentence separates and no structural check does —
     and only one is what the backend refuses. */
  it("says of each code what the backend constant it answers refuses", () => {
    const feld = (code: string) => Object.values(mapBewerbungSubmitRefusal(refusalFor(code))?.fieldErrors ?? {}).join(" ");
    const banner = (code: string) => mapBewerbungSubmitRefusal(refusalFor(code))?.error ?? "";

    // The season stopped taking applications; nothing about the school is at fault.
    assert.match(banner("REQ-BEWERBUNG-004"), /keine Bewerbungen/);
    assert.doesNotMatch(banner("REQ-BEWERBUNG-004"), /Schule|Kürzel/);

    // Both-or-neither: the answer is the choice itself, not a clash with anything stored.
    assert.match(feld("REQ-BEWERBUNG-005"), /entweder/);
    assert.match(feld("REQ-BEWERBUNG-005"), /oder/);

    /* The picker never offered this club, so a reload is the primary repair; the new-school arm is an
       alternative and has to carry the free-Kürzel qualifier, or it promises a path `-008` refuses. */
    assert.match(feld("REQ-BEWERBUNG-006"), /[Ll]ade die Seite neu/);
    assert.match(feld("REQ-BEWERBUNG-006"), /frei\w* Kürzel/);

    /* PLAYS, present tense and scoped to THIS season. `/spielt/` alone matches inside „mitgespielt“,
       which says past seasons; the register says a club standing in the season applied for. */
    assert.match(feld("REQ-BEWERBUNG-007"), /\bspielt\b/);
    assert.match(feld("REQ-BEWERBUNG-007"), /dieser Saison/);
    assert.doesNotMatch(feld("REQ-BEWERBUNG-007"), /beworben|Bewerbung|gespielt|früher|einmal/);
  });

  /* `READ-BEWERBUNG-001`: these two answer an anonymous caller, so neither may disclose that a club
     exists or its state. The vocabulary is READ OFF the teams facet, so a status added there is
     covered here too. */
  it("keeps both roster-facing refusals free of every status word the app uses", () => {
    const facets = readFileSync(path.join(SRC_DIR, "features", "teams", "facets.ts"), "utf8");
    const statuses = [...facets.matchAll(/value: "(stillgelegt|ausgeschieden|\w+)", label: "([A-ZÄÖÜ]\w+)"/g)].map((t) => t[2]!);

    assert.ok(statuses.length > 0, "no status vocabulary was read, so this test compares nothing");

    // Beyond the table: words that disclose a club's existence or its past without naming a status.
    const verraeter = [...statuses, "existiert", "gibt es", "früher", "ehemalig", "gelöscht", "entfernt", "reaktiv"];

    for (const code of ["REQ-BEWERBUNG-006", "REQ-BEWERBUNG-008"]) {
      const satz = Object.values(mapBewerbungSubmitRefusal(refusalFor(code))?.fieldErrors ?? {}).join(" ");

      for (const wort of verraeter) {
        assert.ok(!satz.toLowerCase().includes(wort.toLowerCase()), `${code} discloses roster state with „${wort}“`);
      }
    }
  });

  /* Pydantic holds body rules this mirror does not and answers them 422 with no field named. Left to
     the shared handler, a deterministic refusal reads as „Versuche es erneut“ and invites a retry
     that answers the same way every time. */
  it("answers a body refusal with the boxes to check rather than an invitation to retry", () => {
    const antwort = mapBewerbungSubmitRefusal(badStatus(422, "REQ-VAL-001"));

    assert.notEqual(antwort, null, "a 422 falls through to the generic retry sentence");
    assert.doesNotMatch(antwort?.error ?? "", /erneut/, "the answer asks for the same request a second time");
    assert.match(antwort?.error ?? "", /Telefonnummern|E-Mail/, "the answer names no box to look at");
  });
});

describe("what the blur-time Kürzel check says short of a refusal", () => {
  const verdikt = (shorthand: string, vergeben: boolean) => ({ shorthand: shorthand, vergeben: vergeben });

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
    assert.equal(kuerzelHinweis("GG", verdikt("GY", false), false), KUERZEL_UNGEPRUEFT);
    assert.equal(kuerzelHinweis("GG", verdikt("GY", true), false), KUERZEL_UNGEPRUEFT);
  });

  it("confirms a free code, and leaves a taken one to the field error", () => {
    assert.match(kuerzelHinweis("GG", verdikt("GG", false), false) ?? "", /noch frei/);
    assert.equal(kuerzelHinweis("GG", verdikt("GG", true), false), null);
  });
});
