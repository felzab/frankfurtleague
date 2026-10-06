import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";

import { KONTAKT_EMAIL } from "@/core/brand.ts";
import { ADMIN_WINDOW_HOURS, PERSON_LIFETIME, SESSION_EXPIRES_IN_DAYS } from "@/core/sessionLifetimes.ts";
import { CODE_FAILURE_WINDOW_HOURS } from "@/core/signInCode.ts";
import { ADMIN_SIDEMENU_STRUCTURE } from "@/features/admin/constants.ts";
import {
  BEWERBUNG_BESTAETIGUNG_FRIST_TAGE,
  BEWERBUNG_ERINNERUNG_TAGE,
  BEWERBUNG_MAX_ALTER,
  BEWERBUNG_MIN_ALTER,
  VERTRETUNG_MIN_ALTER,
} from "@/features/bewerbungen/constants.ts";
import { MEDIEN_MIN_ALTER, REGISTRIERUNG_BESTAETIGUNG_FRIST_TAGE, REGISTRIERUNG_MIN_ALTER } from "@/features/registrierungen/constants.ts";
import { SCHIEDSRICHTER_BESTAETIGUNG_FRIST_TAGE, SCHIEDSRICHTER_MIN_ALTER } from "@/features/schiedsrichter/constants.ts";
import { SPERRE_DAUER_HINWEIS, SPERRE_DAUER_SAISONS } from "@/features/sperrliste/constants.ts";
import { renderMarkup, textOf } from "@/shared/testing/renderTest";

const { DatenschutzView } = await import("./DatenschutzView.tsx");
// After the harness, as the view is: the module is `server-only`, which the harness stands in for.
const { CODE_VALIDITY_MINUTES } = await import("@/core/authEmail.ts");

const MARKUP = renderMarkup(DatenschutzView, {});

const worte = (html: string): string => textOf(html, " ").replace(/\s+/g, " ").trim();

/** Every paragraph and list item the notice renders, so a claim is pinned as the whole run a reader meets. */
const ABSAETZE = [...MARKUP.matchAll(/<(p|li)\b[^>]*>([\s\S]*?)<\/\1>/g)].map((element) => worte(element[2] ?? ""));

/** The label-and-value pairs of both `<dl>` lists, the retention table among them, keyed by the label. */
const ANGABEN = new Map(
  [...MARKUP.matchAll(/<dt\b[^>]*>([\s\S]*?)<\/dt>\s*<dd\b[^>]*>([\s\S]*?)<\/dd>/g)].map((pair) => [
    worte(pair[1] ?? ""),
    worte(pair[2] ?? ""),
  ]),
);

const rendert = (absatz: string): void => assert.ok(ABSAETZE.includes(absatz), `no paragraph of the notice reads:\n  ${absatz}`);

/** The whole page as a reader meets it, cards, table cells and headings included. */
const SEITE = worte(MARKUP);

const vorkommen = (phrase: string): number => SEITE.split(phrase).length - 1;

/**
 * The „Stand“ and the words it dates, frozen together: a reader told nothing changed since that day
 * has been misled by any edit that left the date standing.
 */
const FASSUNG = { stand: "6. Oktober 2026", digest: "9db40250f619af003f18974759275a8c935c350899b3a9e66276333ec6a191f8" } as const;

/** Every word the page renders but its date, so moving the date alone never passes for moving the words. */
const wortlautDigest = (): string =>
  createHash("sha256")
    .update(SEITE.replace(/Stand: \d{1,2}\. \p{L}+ \d{4}/u, ""), "utf8")
    .digest("hex");

/* German writes a small count in words, so the notice states its clocks in words. This table is the
   case's own, never the view's, so a wrong word in the view's table fails rather than agreeing with itself. */
const ZAHLWORT: Readonly<Record<number, string>> = { 3: "drei", 5: "fünf", 7: "sieben", 10: "zehn", 14: "vierzehn" };

function inWorten(zahl: number): string {
  const wort = ZAHLWORT[zahl];
  assert.ok(wort !== undefined, `the notice writes ${String(zahl)} in a word this case does not hold`);

  return wort;
}

/** The word opening a sentence, as each retention cell opens on its clock. */
const amAnfang = (wort: string): string => `${wort.charAt(0).toUpperCase()}${wort.slice(1)}`;

describe("the privacy notice's account of the association", () => {
  it("states the joint representation without naming a single board member", () => {
    rendert("Vertreten wird der Verein durch seinen Vorstand; jeweils zwei Vorstandsmitglieder vertreten ihn gemeinsam.");
  });

  it("gives the register court and the register number", () => {
    rendert(
      "Der Verein ist im Vereinsregister des Amtsgerichts Frankfurt am Main unter VR 17757 eingetragen. " +
        "Eine Telefonnummer für den Verein gibt es nicht; wir sind über die E-Mail-Adresse oben erreichbar.",
    );
  });

  /* The „Stand“ is what a reader compares against the version they last read, so it moves with any
     change to this page and a stale one tells them there was none. */
  it("dates the notice to the day this wording landed", () => {
    rendert(`Stand: ${FASSUNG.stand}`);
    assert.equal(
      wortlautDigest(),
      FASSUNG.digest,
      "the notice's words changed: move constants.ts :: DATENSCHUTZ_STAND to the day they land, then FASSUNG to that day and this digest",
    );
  });
});

describe("the privacy notice's account of a birthdate", () => {
  it("says the birthdate is compulsory and what it is checked against", () => {
    rendert(
      "Wer sich über den Link eines Teams registriert oder einen Eintrag als Schiedsrichterin oder Schiedsrichter bestätigt, trägt dabei " +
        "das eigene Geburtsdatum ein. Die Angabe ist Pflicht und wird nicht veröffentlicht: Mitspielen und Pfeifen kann nur, wer mindestens " +
        `${String(REGISTRIERUNG_MIN_ALTER)} Jahre alt ist, und das prüfen wir an diesem Datum. Bei Spielerinnen und Spielern, die schon vor ` +
        "der Registrierung im Kader standen, kann die Verwaltung das Geburtsdatum nachtragen.",
    );
  });

  /* Three floors behind one „16“, and no German sentence names three without repeating one: the
     merge is deliberate, and it becomes a lie the day any of them moves. */
  it("carries one age floor for playing, refereeing and standing as a contact person", () => {
    rendert(
      `Mitspielen, Pfeifen und Kontaktperson einer Bewerbung sein kann nur, wer mindestens ${String(REGISTRIERUNG_MIN_ALTER)} Jahre alt ` +
        `ist; als Ansprechperson oder Stellvertretung mindestens ${String(VERTRETUNG_MIN_ALTER)}.`,
    );
  });

  it("is a sentence the three floors it merges still permit", () => {
    assert.deepEqual(
      { pfeifen: SCHIEDSRICHTER_MIN_ALTER, kontaktperson: BEWERBUNG_MIN_ALTER },
      { pfeifen: REGISTRIERUNG_MIN_ALTER, kontaktperson: REGISTRIERUNG_MIN_ALTER },
    );
  });
});

describe("the privacy notice's account of an application", () => {
  it("gives the two floors a contact seat is held to", () => {
    rendert(
      "Über das Bewerbungsformular kann eine Schule ihre Aufnahme in die Liga beantragen. Als Kontaktperson eingetragen werden darf, wer " +
        `mindestens ${String(BEWERBUNG_MIN_ALTER)} Jahre alt ist; als Ansprechperson oder Stellvertretung nur, wer mindestens ` +
        `${String(VERTRETUNG_MIN_ALTER)} Jahre alt ist.`,
    );
  });

  it("states the confirmation's floors, its reminder and its deletion clock", () => {
    rendert(
      "Jede der drei Kontaktpersonen bekommt eine eigene E-Mail mit einem persönlichen Link. Über diesen Link bestätigt sie ihren Eintrag " +
        "in der genannten Rolle und trägt dabei ihr Geburtsdatum ein. Das Geburtsdatum erreicht uns also erst an dieser Stelle und von der " +
        `Person selbst; wir prüfen damit, ob sie das Mindestalter ihrer Rolle erreicht: ${String(BEWERBUNG_MIN_ALTER)} Jahre für die ` +
        `Trainerin oder den Trainer, ${String(VERTRETUNG_MIN_ALTER)} Jahre für Ansprechperson und Stellvertretung. Das ist keine ` +
        "Einwilligung, sondern eine Bestätigung: Sie belegt, dass die angegebene E-Mail-Adresse zu dieser Person gehört, dass die Person " +
        "von ihrem Eintrag weiß, dass sie dieses Mindestalter erreicht und dass sie diese Datenschutzerklärung zur Kenntnis nehmen " +
        `konnte. Nach ${inWorten(BEWERBUNG_ERINNERUNG_TAGE)} Tagen erinnern wir einmal. Die Bewerbung bleibt so lange offen, bis alle ` +
        `drei bestätigt haben. Hat ${inWorten(BEWERBUNG_BESTAETIGUNG_FRIST_TAGE)} Tage nach dem Versand dieser E-Mails nicht jede ` +
        "Person bestätigt, löschen wir die Bewerbung mit allen Kontaktdaten. Ersetzen wir einen Link durch einen neuen, beginnt diese " +
        "Frist für die ganze Bewerbung von vorn; eine Erinnerung verschiebt sie nicht.",
    );
  });
});

describe("the privacy notice's retention table", () => {
  it("gives an unconfirmed application the clock the sweep deletes on", () => {
    assert.equal(
      ANGABEN.get("Bewerbung, bei der nicht alle Kontaktpersonen bestätigt haben"),
      `${amAnfang(inWorten(BEWERBUNG_BESTAETIGUNG_FRIST_TAGE))} Tage ab dem Versand der Bestätigungslinks, dann Löschung; ein Ersatzlink setzt ` +
        "die Frist für die ganze Bewerbung neu, eine Erinnerung nicht. Ist die Adresse der Ansprechperson dauerhaft nicht erreichbar, " +
        "bleibt die Bewerbung stehen, bis die Verwaltung eine erreichbare Adresse einträgt oder über die Bewerbung entscheidet, " +
        "längstens bis zum Ende der beworbenen Saison; die angekündigte Löschung ginge sonst an niemanden",
    );
  });

  /* Nothing deletes an invite row, so the cell promises the link's end and never the entry's: a
     retention promise no sweep performs is one a reader can hold us to. */
  it("says a team's registration link expires while its entry stays", () => {
    assert.equal(
      ANGABEN.get(
        "Registrierungslink eines Teams: der Link als unlesbarer Schlüssel, dazu das Datum und die anlegende Person aus der Verwaltung",
      ),
      "Kein eigener Zeitraum: Der Link endet mit der Registrierungsfrist der Saison, für die er gilt, oder sobald die Verwaltung ihn " +
        "zurückzieht oder durch einen neuen ersetzt. Der Eintrag dazu enthält den Link nur als unlesbaren Schlüssel, nennt keine " +
        "Spielerin und keinen Spieler und bleibt mit dem Datum und der E-Mail-Adresse der Person aus der Verwaltung, die ihn angelegt " +
        "hat, bestehen.",
    );
  });

  /* One fate per clock the registration sweep and the admission run: the admission erases the row, a
     decline starts a month, and a season ending undecided takes the rest. */
  it("gives a pupil's registration three fates, one per decision, and keeps who declined it as long as the decline", () => {
    assert.equal(
      ANGABEN.get("Registrierung eines Spielers oder einer Spielerin"),
      `${amAnfang(inWorten(REGISTRIERUNG_BESTAETIGUNG_FRIST_TAGE))} Tage ab dem Versand des Bestätigungslinks, wenn die Registrierung nicht ` +
        "bestätigt wird, dann Löschung; eine Erinnerung verschiebt diese Frist nicht. Eine bestätigte Registrierung behalten wir, bis " +
        "das Team über sie entscheidet: Nimmt es die Person auf, löschen wir die Registrierung, und ihre Angaben stehen von da an " +
        "im Kadereintrag; lehnt es sie ab, löschen wir sie einen Monat nach der Entscheidung, und mit ihr Datum, Grund und " +
        "E-Mail-Adresse der Person aus dem Team, die abgelehnt hat. Ist bis zum Ende der Saison nicht " +
        "entschieden, löschen wir sie dann",
    );
  });

  it("names everything a referee's confirmation record holds, the birthdate included", () => {
    assert.equal(
      ANGABEN.get(
        "Bestätigung einer Schiedsrichterin oder eines Schiedsrichters: Geburtsdatum, die beiden Antworten (Veröffentlichung, Medien) " +
          "und die Fassung des Textes; dazu der Bestätigungslink als unlesbarer Schlüssel mit Versanddatum und Frist",
      ),
      "Solange der Eintrag besteht: Die Angaben gehen mit dem Eintrag. Der Link gilt " +
        `${inWorten(SCHIEDSRICHTER_BESTAETIGUNG_FRIST_TAGE)} Tage ab dem Versand, wird durch jeden neuen Link ersetzt und mit dem ` +
        "Eintrag gelöscht",
    );
  });

  /* The address may be a stranger's, so its retention is stated with the clock that ends it once its link has lapsed. */
  it("gives a referee's unconfirmed new address its retention and the removal once its link has lapsed", () => {
    assert.equal(
      ANGABEN.get(
        "Neue E-Mail-Adresse einer Schiedsrichterin oder eines Schiedsrichters, solange sie nicht bestätigt ist, dazu ihr " +
          "Link als unlesbarer Schlüssel mit Versanddatum und Frist",
      ),
      "Bis die Adresse über ihren Link bestätigt oder abgelehnt wird oder die Verwaltung die Änderung verwirft; mit dem Eintrag " +
        "wird sie gelöscht. Ihr Link gilt so lange wie der Bestätigungslink des Eintrags und wird durch jeden neuen ersetzt. Ist er abgelaufen," +
        " löschen wir die Adresse bei der jährlichen Löschung nach dem Ende der Registrierungsfrist",
    );
  });

  /* Two addresses are in play, so the sentence names the one the notice of the change goes to rather than a „sie“ fitting both. */
  it("says the address on file stays in force and is the one told of a confirmed referee's address change", () => {
    rendert(
      "Ändert die Verwaltung Deine E-Mail-Adresse, nachdem Du Deinen Eintrag bestätigt hast, gilt die neue erst, wenn Du sie über den " +
        "Link bestätigt hast, den wir an sie schicken; bis dahin bleibt die bisherige in Kraft, und an die bisherige schicken wir einen " +
        "Hinweis auf die Änderung.",
    );
  });

  it("gives a rejected application, the action log and the backups their clocks in words", () => {
    assert.equal(ANGABEN.get("Abgelehnte Bewerbung samt den Daten der drei Kontaktpersonen"), "Ein Monat nach der Entscheidung");
    assert.ok(
      ANGABEN.get("Änderungsprotokoll: Änderungen der Verwaltung und Änderungen angemeldeter Personen")?.startsWith(
        "Zwölf Monate ab dem Eintrag;",
      ),
    );
    assert.equal(ANGABEN.get("Sicherungskopien der Datenbank"), "Etwa acht Tage");
  });

  it("gives a sign-in code its lifetime in words, at the constant the sign-in enforces", () => {
    assert.ok(
      ANGABEN.get("Anmeldung: E-Mail-Adresse, Anmeldecode, Sitzung und Passkey")?.startsWith(
        `Ein Anmeldecode gilt ${inWorten(CODE_VALIDITY_MINUTES)} Minuten und wird danach gelöscht;`,
      ),
    );
  });

  it("names what it keeps of each passkey beyond the key itself", () => {
    assert.ok(
      ANGABEN.get("Anmeldung: E-Mail-Adresse, Anmeldecode, Sitzung und Passkey")?.includes(
        "Zu jedem Passkey speichern wir, wann er zuletzt benutzt wurde, und den Namen, den Du ihm gibst.",
      ),
    );
  });

  /* The rows counting an address's failed codes outlive the code by a day, and are told apart from
     the address itself only by being keyed. */
  it("says how long an address's failed codes are counted, at the constant the count keeps", () => {
    assert.ok(
      ANGABEN.get("Anmeldung: E-Mail-Adresse, Anmeldecode, Sitzung und Passkey")?.includes(
        `Falsch eingegebene Codes zählen wir ${String(CODE_FAILURE_WINDOW_HOURS)} Stunden lang, angeforderte Codes eine Stunde lang, beides unter einem unlesbaren Schlüssel statt unter der Adresse;`,
      ),
    );
  });
});

/* German writes one to twelve in words: the same count in digits in one place and in a word in another reads as two
   clocks. */
describe("the privacy notice writes its small counts in words", () => {
  it("states no count from one to twelve in digits, anywhere on the page", () => {
    const inZiffern = SEITE.match(/(?<![\d.,/])(?:[1-9]|1[0-2]) (?:Tage?n?|Wochen?|Monate?n?|Jahre?n?|Stunden?|Minuten?|Saisons?)\b/g) ?? [];

    assert.deepEqual(inZiffern, []);
  });
});

/* The sign-in's two session figures, in both places the notice states them: typed, they stay true
   only until `fl_frontend/src/core/sessionLifetimes.ts` moves. */
describe("the privacy notice states the sign-in's session figures at the constants the sign-in enforces", () => {
  const LEERLAUF = `${String(SESSION_EXPIRES_IN_DAYS)} Tage lang nicht genutzt`;
  const VERWALTUNG = `${String(ADMIN_WINDOW_HOURS)} Stunden`;

  // A person's two figures, never the library's one: the longest of all four is nobody's idle window.
  it("in the retention table", () => {
    const zeile = ANGABEN.get("Anmeldung: E-Mail-Adresse, Anmeldecode, Sitzung und Passkey") ?? "";
    const tage = (ms: number): string => String(ms / (24 * 60 * 60 * 1000));

    assert.ok(
      zeile.includes(
        `Eine Sitzung endet, wenn sie ${tage(PERSON_LIFETIME.idle)} Tage lang nicht genutzt wurde, spätestens aber ` +
          `${tage(PERSON_LIFETIME.absolute)} Tage nach der Anmeldung; für die Verwaltung gilt sie höchstens ${VERWALTUNG}.`,
      ),
    );
  });

  it("in the cookie section", () => {
    assert.ok(SEITE.includes(`Das Cookie selbst läuft ab, wenn die Sitzung ${LEERLAUF} wurde`));
    assert.ok(SEITE.includes(`für den Zugang zur Verwaltung nicht länger als ${VERWALTUNG}, und verlangen danach eine neue Anmeldung`));
  });
});

/* A transfer resting on the standard clauses says where a copy is had, and one resting on an adequacy
   decision names it, each at every statement: a reader meets one section, not the page. */
describe("the privacy notice's transfer statements", () => {
  it("offers a copy of the clauses wherever a transfer falls back on them", () => {
    assert.equal(vorkommen("Standardvertragsklauseln der Europäischen Kommission"), 2);
    assert.equal(vorkommen(`Eine Kopie der Klauseln schicken wir Dir auf Anfrage an ${KONTAKT_EMAIL} .`), 2);
  });

  it("names the adequacy decision each prose statement rests on", () => {
    assert.equal(vorkommen("Durchführungsbeschluss (EU) 2023/1795, Art. 45 DSGVO"), 2);
    assert.equal(vorkommen("Die Schweiz gilt als Land mit einem angemessenen Datenschutzniveau (Entscheidung 2000/518/EG"), 1);
  });

  // Adopted under the directive, the Swiss decision stands under the GDPR only through Art. 45(9).
  it("names the article the Swiss decision stands under", () => {
    assert.equal(vorkommen("(Entscheidung 2000/518/EG der Europäischen Kommission, fortgeltend nach Art. 45 Abs. 9 DSGVO)"), 1);
  });
});

/* Each row is a sentence the tree made untrue and what replaced it: the absence alone passes on a
   page that lost the passage, so the replacement is asserted too, here unless a case above pins it whole. */
const ERSETZT: readonly { weg: string; statt?: string }[] = [
  { weg: "wird von der Verwaltung der Liga eingetragen" },
  { weg: "eine Altersgrenze für den Kader prüfen wir damit nicht" },
  { weg: "Die 16 Jahre gelten allein für die Kontaktperson" },
  { weg: "Wenn Dein Name auf dieser Website steht", statt: "Wenn Du bei uns mitspielst oder pfeifst und Dein Name auf dieser Website steht" },
  { weg: "Du musst nichts begründen", statt: "Begründen musst Du nur einen Widerspruch, und zwar mit Deiner besonderen Situation" },
  { weg: "keinen Grund angeben", statt: "Einen Grund nennst Du nur bei einem Widerspruch: Deine besondere Situation" },
  { weg: "formlos und ohne Begründung", statt: "Begründen musst Du nur einen Widerspruch, mit Deiner besonderen Situation." },
  { weg: "also Eingangsbestätigungen, Bestätigungslinks, Erinnerungen", statt: "Alle E-Mails der Liga versenden wir über Resend." },
  { weg: "Resend, Inc.", statt: "Unser Vertragspartner dafür ist die Plus Five Five, Inc. mit Sitz in den Vereinigten Staaten" },
  {
    weg: "Diesen Zustellstand speichern wir bei der Person",
    statt: "Diesen Zustellstand speichern wir bei dem Eintrag, um den es in der Nachricht geht.",
  },
  {
    weg: "Abs. 1 lit. b",
    statt: "Rechtsgrundlage für alle Angaben der Bewerbung, zur Schule, zum Team und zu den drei eingetragenen Personen",
  },
  { weg: "Wer diesen Weg nicht will, wird ausschließlich per E-Mail und Telefon erreicht", statt: "WhatsApp ist kein Kanal der Liga." },
  { weg: "die uns auf diesem Weg schreiben", statt: "denen wir dort einzeln schreiben oder die uns dort schreiben" },
  {
    weg: "Nicht veröffentlicht werden die Kontaktdaten der drei Kontaktpersonen",
    statt: "Nicht veröffentlicht werden die Kontaktdaten und Geburtsdaten aller Personen",
  },
  { weg: "Die beiden vollständigen Namen im Impressum", statt: "Die vollständigen Namen der Vorstandsmitglieder im Impressum" },
  {
    weg: "Diese Website setzt zwei Dinge im Browser",
    statt: "Diese Website legt in Deinem Browser nur ab, was für ihren Betrieb notwendig ist:",
  },
  { weg: "Darüber hinaus speichern wir nichts in Deinem Browser", statt: "Darüber hinaus wird nichts in Deinem Browser abgelegt" },
  {
    weg: "nach höchstens 90 Tagen",
    statt: `Das Cookie selbst läuft ab, wenn die Sitzung ${String(SESSION_EXPIRES_IN_DAYS)} Tage lang nicht genutzt wurde`,
  },
  { weg: "Anmeldelink", statt: "Ein Anmeldecode gilt zehn Minuten und wird danach gelöscht" },
  { weg: "Ein Sitzungs-Cookie für angemeldete Administratorinnen und Administratoren", statt: "Ein Sitzungs-Cookie für angemeldete Personen." },
  {
    weg: "Während eine Administratorin oder ein Administrator einen Passkey einrichtet",
    statt: "Die Anmeldeseite setzt es schon beim Aufruf, damit Dein Browser Dir einen gespeicherten Passkey im Adressfeld anbieten kann",
  },
  { weg: "Es findet keine automatisierte Entscheidungsfindung" },
  // The media-consent and Stufe refusals exist too, reachable only by a request no page sends.
  { weg: "Ohne einen Menschen weist die Website nur zweierlei zurück" },
  // The bot check and the day ceiling refuse without a human too, and the notice names every such refusal.
  { weg: "weist sie ohne einen Menschen nur zweierlei zurück" },
  // The account page's step-up mails a code with no bot check, and an unanswered check lets a form through.
  {
    weg: "bevor wir einen Anmeldecode verschicken",
    statt:
      "bevor wir über die Anmeldeseite einen Anmeldecode verschicken oder eine Bewerbung oder Registrierung speichern; antwortet Cloudflare dabei nicht, nehmen wir das Formular ungeprüft an.",
  },
  { weg: "Einen Anmeldecode verschickt sie" },
  { weg: "an ihren eigenen Angaben", statt: "Änderungen der Verwaltung und Änderungen angemeldeter Personen" },
  { weg: "Trainerinnen, Trainern und Ansprechpersonen ab", statt: "Schiedsrichtern und Kontaktpersonen eines Teams ab" },
  { weg: "Er enthält nur die Zahl der Änderungen und Deine Rolle" },
  { weg: "Hältst Du eine solche" },
  { weg: "Unter dem Mindestalter kann Dich auch ein Mensch nicht zulassen" },
  { weg: "den Wettbewerb durchzuführen" },
  { weg: "Wird Dein Eintrag gelöscht" },
  {
    weg: "Dasselbe gilt für das Betriebsprotokoll",
    statt: "Das Betriebsprotokoll der Anwendung verarbeiten wir auf derselben Grundlage und zu demselben Zweck",
  },
  {
    weg: "Freiwillig sind nur die Website der Schule und der Wunschgegner",
    statt: "die Angabe zu vorhandenen Trikotsätzen und der Wunschgegner",
  },
  { weg: "Aufwandsentschädigung", statt: "die Schule und das Honorar einer Schiedsrichterin oder eines Schiedsrichters" },
  { weg: "ohne eingetragene Adresse" },
  // The per-address rows are written ahead of the send gate, so they count what was asked for, a stranger's asking included.
  { weg: "versandte Codes", statt: "angeforderte Codes eine Stunde lang" },
  // The passkey ceremony's row holds the account's id when the visitor is already signed in.
  { weg: "einen Eintrag ohne Angaben zu Deiner Person", statt: "steht darin die Kennung Deines Kontos, sonst nichts über Dich" },
  { weg: "solange der Zugang besteht", statt: "Adresse und Passkeys bleiben, solange das Konto besteht" },
  { weg: "Der Eintrag dazu nennt keine Person" },
  { weg: "Das gilt nicht, wenn Dein Eintrag als Schiedsrichterin oder Schiedsrichter schon gelöscht war" },
  { weg: "Alles davon ist unbedingt erforderlich", statt: "Was wir selbst ablegen, ist unbedingt erforderlich" },
  // Cloudflare's challenge and clearance are Cloudflare's, so their freedom from consent is stated as
  // the league's reliance, naming the read as well as the write, and never as a conclusion that
  // nothing needs one.
  {
    weg: "Die Freigabe von Cloudflare setzen wir",
    statt:
      "Die Abfragen und die Freigabe von Cloudflare setzen wir ohne Einwilligung ein, weil sie die Anmeldung und die Formulare vor " +
      "automatisiertem Missbrauch schützen (§ 25 Abs. 2 Nr. 2 TDDDG).",
  },
  {
    weg: "weil es nichts einzuwilligen gibt",
    statt: "und es gibt keinen Cookie-Banner, weil wir für nichts davon eine Einwilligung einholen.",
  },
  // No rule checks a form's submission, so the clearance a navigation's challenge leaves spares a second challenge and nothing more.
  { weg: "damit das Formular abgeschickt werden kann", statt: "damit Du beim nächsten Aufruf nicht erneut geprüft wirst" },
  // Self-service withdrawal on the account page stands beside the e-mail route.
  {
    weg: "Du kannst diese Einwilligung jederzeit mit Wirkung für die Zukunft widerrufen, formlos an",
    statt: "beide nimmst Du außerdem selbst in Deinem Konto zurück",
  },
  {
    weg: "Das ist die einzige Einwilligung, die wir an dieser Stelle einholen",
    statt: "Auf derselben Seite stehen zwei freiwillige Schalter.",
  },
  // Standing between the decision and the clause, the citation made the decision what Cloudflare is certified under.
  { weg: "Art. 45 DSGVO), nach dem Cloudflare zertifiziert ist", statt: "Nach diesem Framework ist Cloudflare zertifiziert" },
  // The admission erases a registration it takes, so no confirmed one waits for the next season.
  { weg: "bis in der nächsten Saison die Registrierung geschlossen ist" },
  {
    weg: "Das betrifft die Zugriffsprotokolle",
    statt: "Das betrifft jede Verarbeitung, für die diese Erklärung Art. 6 Abs. 1 lit. f DSGVO als Rechtsgrundlage nennt",
  },
];

describe("the privacy notice's account of the site's own protection", () => {
  /* Three pages load the check, and a page left out of the notice is processing nobody was told of. */
  it("names Cloudflare's bot check on all three pages that load it, and Cloudflare's own use of what it reads", () => {
    const absatz = ABSAETZE.find((text) => text.startsWith("Eine zweite Prüfung von Cloudflare, Turnstile,")) ?? "";

    assert.ok(absatz.includes("auf der Anmeldeseite, im Bewerbungsformular und im Registrierungsformular"), absatz);
    assert.ok(absatz.includes("Cloudflare verwendet diese Merkmale außerdem in eigener Verantwortung"), absatz);
  });

  /* A browser that blocks the check stays refused, so the notice says so and names the way in that remains. */
  it("says a blocked check takes nothing in, and names the league's address and the passkey as the ways in", () => {
    const absatz = ABSAETZE.find((text) => text.startsWith("Eine zweite Prüfung von Cloudflare, Turnstile,")) ?? "";

    assert.ok(
      absatz.includes(
        `Lässt Dein Browser oder ein Werbeblocker diese Prüfung nicht zu, nehmen wir über diese drei Formulare nichts an; dann erreichst Du uns unter ${KONTAKT_EMAIL}`,
      ),
      absatz,
    );
    assert.ok(absatz.endsWith("und anmelden kannst Du Dich auch mit einem Passkey."), absatz);
  });

  it("gives a person's daily count its clock, and says it holds no address", () => {
    const frist = ANGABEN.get("Tageszähler einer angemeldeten Person, je Funktion") ?? "";

    // Past midnight by the TTL monitor's lag (`docs/backend/spec.md :: I837`), and per kind of person a write is made as, never per mailbox.
    assert.ok(frist.startsWith("Bis kurz nach Mitternacht des Tages, den er zählt."), frist);
    assert.ok(
      frist.includes(
        "wie oft Du in dieser Funktion an dem Tag etwas ändern wolltest, darunter auch Änderungen, die danach noch abgewiesen wurden",
      ),
      frist,
    );
    assert.ok(frist.includes("unter einem unlesbaren Schlüssel statt Deiner Adresse"), frist);
  });
});

describe("the privacy notice keeps no sentence the tree made untrue", () => {
  for (const { weg, statt } of ERSETZT) {
    it(`replaces „${weg}“`, () => {
      assert.equal(vorkommen(weg), 0, `the notice still reads „${weg}“`);
      if (statt !== undefined) assert.ok(SEITE.includes(statt), `the notice lacks its replacement „${statt}“`);
    });
  }
});

/* Read by row label and counted, because „14 Tage“ is also the application's clock: a page-wide
   search for fourteen passes while the referee's is missing. */
describe("the privacy notice states the registration, referee-link and ban clocks once, at the constant's value", () => {
  it("gives an unconfirmed registration its own clock and no second one", () => {
    // In digits or in a word: a restatement written out would otherwise pass as no second clock.
    const genannt = new RegExp(
      `(?<![0-9])(${String(REGISTRIERUNG_BESTAETIGUNG_FRIST_TAGE)}|${inWorten(REGISTRIERUNG_BESTAETIGUNG_FRIST_TAGE)}) Tage`,
      "gi",
    );
    assert.equal(SEITE.match(genannt)?.length, 1);
  });

  it("gives a referee's link its own clock and no second one", () => {
    const phrase = `Der Link gilt ${inWorten(SCHIEDSRICHTER_BESTAETIGUNG_FRIST_TAGE)} Tage ab dem Versand`;

    assert.equal(vorkommen(phrase), 1);
    assert.equal(vorkommen("Der Link gilt"), 1, "a second sentence states how long a link lasts");
  });

  it("gives a ban the five full seasons the ban list keeps it for, in words", () => {
    const saisons = inWorten(SPERRE_DAUER_SAISONS);

    assert.ok(
      ANGABEN.get(
        "Gesperrte E-Mail-Adresse, als unlesbarer Schlüssel, dazu der Grund, das Datum und die eintragende Person aus der Verwaltung",
      )?.startsWith(`${saisons.charAt(0).toUpperCase()}${saisons.slice(1)} volle Saisons nach der Saison des Eintrags`),
    );
    assert.ok(SEITE.includes(`bis die Sperre nach ${saisons} vollen Saisons endet`));
  });

  /* A grant names a person of the administration twice, its holder and its granter, and the notice of a
     change is a second record of both; each is kept only as long as it does its job. */
  it("keeps a grant until it is revoked, and the notice of a change only until it is sent", () => {
    assert.equal(
      ANGABEN.get("Zugang zur Verwaltung: E-Mail-Adresse, Stufe, Datum und die Person aus der Verwaltung, die ihn erteilt hat"),
      "Bis der Zugang entzogen wird; eine Benachrichtigung über eine Änderung nur, bis sie versandt ist",
    );
  });

  // Held here because this file owns the count words: the create form's hint and the ban list's
  // sidemenu note state the same length in a word too, and nothing else ties that word to the number.
  it("gives the ban list's create form and its sidemenu note the same seasons, in the same word", () => {
    assert.ok(SPERRE_DAUER_HINWEIS.startsWith(`Die Sperre endet nach ${inWorten(SPERRE_DAUER_SAISONS)} vollen Saisons von selbst.`));

    const sperrliste = ADMIN_SIDEMENU_STRUCTURE.flatMap((group) => group.sub_options).find((option) => option.id === "sperrliste");
    assert.ok(sperrliste?.hint.note?.startsWith(`Eine Sperre endet nach ${inWorten(SPERRE_DAUER_SAISONS)} vollen Saisons von selbst`));
  });
});

describe("the privacy notice's publication and retention rows keep their ruled bases", () => {
  it("publishes a squad list on the person's own consent", () => {
    assert.equal(
      ANGABEN.get("Kaderlisten: Vorname und erster Buchstabe des Nachnamens, sofern die Person dafür eine Einwilligung erteilt hat"),
      "Art. 6 Abs. 1 lit. a DSGVO, mit ausdrücklicher Einwilligung",
    );
  });

  it("publishes media only from the floor the confirmations judge, on its own consent", () => {
    assert.equal(
      ANGABEN.get(
        `Fotos und Videos von Spielerinnen, Spielern, Schiedsrichterinnen, Schiedsrichtern und Kontaktpersonen eines Teams ab ${String(MEDIEN_MIN_ALTER)} Jahren, ` +
          "auf denen die Person zu erkennen ist, und Interviews mit ihr, nur wenn sie den Schalter dafür eingeschaltet hat; veröffentlicht auf dieser " +
          "Website und auf dem Instagram-Kanal der Liga",
      ),
      "Art. 6 Abs. 1 lit. a DSGVO, mit ausdrücklicher Einwilligung; Zweck ist, über die Liga zu berichten",
    );
    rendert(
      `Bist Du jünger als ${String(MEDIEN_MIN_ALTER)} Jahre, veröffentlichen wir keine Fotos oder Videos, auf denen Du zu erkennen bist, ` +
        "und keine Interviews mit Dir.",
    );
  });

  it("names the interest the school's published address serves", () => {
    assert.equal(
      ANGABEN.get("Straßenanschrift der Schule als Anschrift des Teams"),
      "Art. 6 Abs. 1 lit. f DSGVO; unser berechtigtes Interesse ist, zu zeigen, welche Schule hinter einem Team steht und wo sie " +
        "liegt; das Bewerbungsformular sagt es vorher",
    );
  });

  it("says a pupil gives the consent that publishes their name themselves, a minor included", () => {
    rendert(
      "Wer im Kader eines Teams steht, meldet sich über den Link seines Teams selbst an und bestätigt das per E-Mail. Wer ein Spiel " +
        "pfeift, wird von der Verwaltung eingetragen, immer mit E-Mail-Adresse, und bestätigt den Eintrag über einen Link, den wir an " +
        "diese Adresse senden. Vorname und erster Buchstabe des Nachnamens einer Spielerin oder eines Spielers werden nur veröffentlicht, " +
        "wenn für diese Person eine Einwilligung dafür festgehalten ist; ohne sie steht die Person als „anonym“ im Kader. Diese " +
        "Einwilligung gibst Du selbst, auch wenn Du noch nicht volljährig bist. Team, Rückennummer und Position stehen in beiden Fällen " +
        "dort, soweit sie angegeben sind.",
    );
  });

  it("names Instagram as a recipient, with only the facts that were verified", () => {
    assert.ok(
      SEITE.includes(
        "Meta (Instagram) Rolle Anbieter der Plattform Instagram, für seine eigene Verarbeitung selbst verantwortlich Was dorthin " +
          "gelangt Fotos, Videos und Interviews, die wir auf dem Instagram-Kanal der Liga veröffentlichen (Abschnitt 9) Wo Nicht " +
          "festgelegt; die Muttergesellschaft Meta Platforms, Inc. in den Vereinigten Staaten ist nach dem EU-US Data Privacy " +
          "Framework zertifiziert Vereinbarung Keiner; es gelten die Nutzungsbedingungen von Instagram",
      ),
    );
  });

  it("publishes a referee's name on the participation basis and a pupil's only on consent", () => {
    rendert(
      "Rechtsgrundlage für die Daten, die wir für Deine Teilnahme brauchen, ist Art. 6 Abs. 1 lit. f DSGVO. Unser berechtigtes " +
        "Interesse ist, den Spielbetrieb der Liga durchzuführen: Kader und Schiedsrichtereinsätze zu führen, das Mindestalter zu " +
        "prüfen und Dich zu erreichen. Weil viele, die mitspielen oder pfeifen, noch minderjährig sind, veröffentlichen wir von " +
        "Spielerinnen und Spielern auf dieser Grundlage nichts: Dein Name im Kader erscheint nur mit Deiner Einwilligung (Abschnitt " +
        "9). Den Namen einer Schiedsrichterin oder eines Schiedsrichters an einem Spiel veröffentlichen wir auf dieser Grundlage, wie " +
        "Abschnitt 9 es beschreibt. Du kannst jederzeit widersprechen oder die Löschung verlangen (Abschnitt 14).",
    );
  });

  // A deadline rather than „zeitnah“: Art. 12(3) DSGVO bounds the answer at a month.
  it("takes a referee's name off the website within a month of the request", () => {
    rendert(
      `Du kannst jederzeit verlangen, dass Dein Name von dieser Website verschwindet, formlos an ${KONTAKT_EMAIL} . Danach nehmen wir ` +
        "ihn innerhalb eines Monats heraus; an einem vergangenen Spiel steht dann ein neutraler Eintrag statt des Namens.",
    );
  });

  it("tells a final deletion, a requested one and a retirement apart for a referee's fee", () => {
    rendert(
      "Bei Schiedsrichterinnen und Schiedsrichtern trägt die Verwaltung Name und Kontaktdaten ein, dazu die Schule, wenn es eine gibt, so wie Du oder die " +
        "Person, die Dich uns genannt hat, sie uns mitgeteilt hat. Dazu halten wir das Honorar fest, das Dir für ein Spiel zusteht, " +
        "damit wir wissen, was wir Dir schulden; ausgezahlt wird es außerhalb dieser Website. Wird Dein Eintrag endgültig gelöscht, " +
        "geht Dein üblicher Betrag mit ihm; verlangst Du die Löschung, bleibt an einem Spiel, das schon angesetzt oder gespielt ist, " +
        "der Betrag für dieses Spiel ohne Deinen Namen stehen. Setzt die Verwaltung Dich nur nicht mehr ein, bleibt Dein Eintrag mit " +
        "dem Betrag bestehen.",
    );
  });

  // The space before the comma is `textOf`'s separator where the mail link's tag closes.
  it("offers a human review of every refusal taken without one, and says what it can change", () => {
    rendert(
      "Über eine Bewerbung entscheidet ein Mensch. Von dem, was Du auf dieser Website eintragen kannst, weist sie ohne einen " +
        "Menschen zweierlei zurück: ein Geburtsdatum, das Du auf Deiner Bestätigungsseite als Spielerin oder Spieler, als Schiedsrichterin oder Schiedsrichter oder als " +
        "Kontaktperson einer Bewerbung oder eines Teams einträgst, wenn es unter dem Mindestalter Deiner Rolle liegt oder ein Alter über " +
        `${String(BEWERBUNG_MAX_ALTER)} Jahren ergibt, und eine E-Mail-Adresse, die gesperrt ist. Beide Zurückweisungen prüft auf ` +
        `Deinen Wunsch ein Mensch: Schreib an ${KONTAKT_EMAIL} , dann sieht sich jemand aus der Verwaltung Deinen Fall an und ` +
        "antwortet Dir. Ein zurückgewiesenes Geburtsdatum wird nicht gespeichert; war es ein Tippfehler, trägst Du über denselben " +
        "Link das richtige Datum ein, solange er gilt. Liegt Dein Geburtsdatum tatsächlich unter dem Mindestalter, bleibt es auch " +
        "nach der Prüfung bei der Zurückweisung, weil die Liga jede Rolle erst ab ihrem Mindestalter vergibt. Eine Sperre kann die " +
        "Verwaltung nach der Prüfung aufheben. Ist der Kader eines Teams voll, nimmt er keine weitere Registrierung an; das ist " +
        "eine Grenze des Kaders und keine Entscheidung über Dich. Zwei weitere Grenzen setzt die Website ebenso ohne einen " +
        "Menschen. Einen Anmeldecode über die Anmeldeseite verschickt sie, eine Bewerbung und eine Registrierung nimmt sie erst " +
        "an, wenn Cloudflare bestätigt hat, dass ein Mensch das Formular abschickt, oder wenn Cloudflare nicht antwortet " +
        "(Abschnitt 11); bittet Cloudflare Dich um einen Klick, genügt der. " +
        `Lässt Dich die Prüfung nicht durch, schreib an ${KONTAKT_EMAIL} , dann sieht sich jemand aus der Verwaltung Deinen Fall an. ` +
        "Und wer angemeldet ist, kann in jeder Funktion an einem Tag nur eine begrenzte Zahl von Änderungen abschicken; danach " +
        "weist die Website weitere Änderungen bis Mitternacht zurück. Das Zurückziehen einer Einwilligung weist sie dabei nie " +
        `zurück, und auch diese Grenze prüft auf Deinen Wunsch ein Mensch, wenn Du an ${KONTAKT_EMAIL} schreibst. Profiling ` +
        "findet nicht statt.",
    );
  });

  /* The granter's address on each grant outlives their own revoke and erasure (docs/datenschutz.md,
     section 5), so the notice names it where it names what else an administrator's erasure leaves. */
  it("keeps the granter's address on a grant past their own revoke and erasure, among the administrators' limits", () => {
    rendert(
      "Eine Einschränkung gilt für Administratorinnen und Administratoren der Liga: Ihre E-Mail-Adresse bleibt in den Zeilen des " +
        "Änderungsprotokolls stehen, die ihre eigenen Änderungen festhalten, auch nach einer Löschung. Das Protokoll hat nur dann " +
        "einen Sinn, wenn nachvollziehbar bleibt, wer eine Änderung vorgenommen hat. Diese Zeilen werden wie alle anderen gelöscht. " +
        "Außerdem bleibt ihre E-Mail-Adresse bei jedem Registrierungslink eines Teams stehen, den sie angelegt haben; dieser Eintrag " +
        "wird nicht gelöscht (Abschnitt 13). Wer einer Person Zugang zur Verwaltung erteilt hat, bleibt mit seiner E-Mail-Adresse an " +
        "diesem Zugang vermerkt, auch nachdem der eigene Zugang entzogen oder die eigenen Daten gelöscht wurden; alle Personen mit " +
        "Zugang zur Verwaltung sehen diesen Vermerk, solange der erteilte Zugang besteht.",
    );
  });

  /* The account page lists every consent something still rests on, under the address the league reaches
     the person at today, so the notice says where to take one back (Art. 7(3): withdrawing is as easy as
     giving) and which decided records it leaves out. */
  it("names the account as the place to take back a consent something still rests on, signed in with today's address", () => {
    assert.equal(
      vorkommen(
        "Eine Einwilligung, auf die sich bei uns noch etwas stützt, kannst Du außerdem selbst in Deinem Konto zurücknehmen: Melde " +
          "Dich mit der Adresse an, unter der wir Dich heute erreichen; dort steht jede solche Einwilligung. Eine abgelehnte Bewerbung " +
          "oder Registrierung steht dort nicht; wir löschen sie einen Monat nach der Entscheidung.",
      ),
      1,
    );
  });

  /* Only the admission enforces it (`docs/datenschutz.md :: "One address is one person"`); every other
     writer assumes it, so this sentence and the forms' hints are what make it known to the person it binds. */
  it("tells a person that their address stands for them alone and everything under it is their account's", () => {
    rendert("Deine E-Mail-Adresse steht bei uns für Dich allein: Alles, was unter ihr eingetragen ist, gehört zu Deinem Konto.");
  });

  /* Art. 13(1)(e) asks for the recipients: the team's three seats read a pending registration, so the
     notice names them and what they do not see, which the pupil's confirmation page promises as well. */
  it("names the team's three seats as who sees a registration, and what stays with the administrators", () => {
    rendert(
      "Bei der Registrierung trägst Du Vornamen, Nachnamen und E-Mail-Adresse ein und, wenn Du willst, Rückennummer, Position und " +
        "Stufe; mit der Bestätigung kommt Dein Geburtsdatum dazu, wenn wir es noch nicht kennen, und, haben wir unter dieser " +
        "Adresse und diesem Namen noch keine Antworten von Dir, Deine Antworten zu Veröffentlichung und Medien. Über die " +
        "Aufnahme in den Kader entscheidet Dein Team: Trainerin oder Trainer, Ansprechperson und Stellvertretung des Teams sehen " +
        "Deinen Namen, Deine Rückennummer, Deine Position und Deine Stufe; sie sehen auch, ob Du die Registrierung schon bestätigt hast und ob Du schon früher in der Liga eingetragen warst. Deine " +
        "E-Mail-Adresse, Dein Geburtsdatum und Deine Antworten sehen sie nicht; die sehen nur die Administratorinnen und " +
        "Administratoren der Liga. Lehnt Dein Team eine bestätigte Registrierung ab, schreiben wir Dir das per E-Mail. Zur " +
        "Ablehnung halten wir das Datum, den Grund und die E-Mail-Adresse der Person aus dem Team fest, die abgelehnt hat; diese " +
        "Angaben sehen die Administratorinnen und Administratoren der Liga.",
    );
  });

  /* The same-person question shows the team a stored person's name, so the notice says so, and that it
     never shows the birthdate the stored person was promised only administrators see. */
  it("says an address already holding a person makes the team confirm it is the same one, by name alone", () => {
    rendert(
      "Eine E-Mail-Adresse gehört bei uns zu einer Person. Registriert sich jemand mit einer Adresse, unter der schon eine Person " +
        "eingetragen ist, und weichen Name oder Geburtsdatum von diesem Eintrag ab, fragen wir das Team, ob es dieselbe Person ist, " +
        "und nennen ihm dafür den eingetragenen Namen, nie das Geburtsdatum. Ist sie es nicht, lehnt das Team die Registrierung ab, " +
        "und wir bitten die Person, sich mit einer eigenen E-Mail-Adresse erneut zu registrieren.",
    );
  });

  /* Art. 14(3)(a): a contact person the administration typed in learns of it from the link, and a seat
     holder's landing shows the other seats' names and confirmations, never their contact details. */
  it("tells a contact person the administration entered that a link reaches them, and what the other seats see", () => {
    rendert(
      "Trägt die Verwaltung Dich als Kontaktperson eines Teams ein, schicken wir Dir einen Link, über den Du den Eintrag bestätigst " +
        "oder ihm widersprichst. Wer als Kontaktperson eines Teams bestätigt hat, sieht in seinem Bereich, wer die drei Rollen des " +
        "Teams hat und wer davon schon bestätigt hat, aber keine Kontaktdaten und kein Geburtsdatum.",
    );
  });

  it("promises every erasure asked for an emptied action log", () => {
    rendert(
      "Das Änderungsprotokoll: Jede Änderung an den Daten der Liga wird mit dem vorherigen Stand festgehalten, damit ein Fehler " +
        "zurückgenommen werden kann. Dieses Protokoll kann deshalb auch Deine Daten enthalten. Bei einer Löschung auf Wunsch werden " +
        "Deine Einträge darin sofort geleert. Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO; unser berechtigtes Interesse ist, " +
        "Fehler in den Daten der Liga erkennen und rückgängig machen zu können.",
    );
  });

  /* A referee kept only while taking part would close the cell on „bis zu einer Löschung auf Wunsch“,
     words the players' half carries too, so the referee half is read by its own words and the end apart. */
  it("keeps a referee until the entry is deleted rather than only while taking part", () => {
    const zeile = ANGABEN.get("Daten von Spielerinnen, Spielern und Schiedsrichtern") ?? "";

    assert.ok(!zeile.endsWith("bis zu einer Löschung auf Wunsch"));
    assert.ok(zeile.includes("Bei Schiedsrichterinnen und Schiedsrichtern: bis die Verwaltung den Eintrag endgültig löscht"));
  });
});
