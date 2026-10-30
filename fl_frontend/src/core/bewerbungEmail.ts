import "server-only";

import { BRAND_NAME, mailOrigin } from "./emailShell";
import { formatAufzaehlung, formatDatum } from "./format";
import { kontaktBestaetigungsLink } from "./kontaktLink";
import { KONTAKT_ROLLE_LANGFORM, rollenText, TRIKOT_FARBEN } from "./teamVocabulary";

import type { Mail, Paragraph } from "./emailShell";
import type { CalendarDay } from "./format";
import type {
  FLBewerbungAbsageData,
  FLBewerbungErasureData,
  FLBewerbungLinkData,
  FLBewerbungPerson,
  FLBewerbungReceivedData,
  FLBewerbungWiderspruchData,
  FLBewerbungZusageData,
} from "./generated/client/types";
import type { MailLink, MailOrt } from "./mailKinds";

/**
 * Future tense because it has to be: a club is entered only while its season is `future`
 * (`entry_saison_not_future`), and `future` is the one status the public tier is refused
 * (`fl_backend/app/api/saisons/services.py :: WITHHELD_FROM_BASE_TIER`).
 */
const websiteSatz = (site: string): Paragraph => [
  ["Spielplan, Tabelle und Ergebnisse veröffentlichen wir auf ", { url: site }, ", sobald die Saison startet."],
];

/**
 * A wish answered as one. The Spielplan is drawn after the decision, so nothing here knows whether it
 * can be met, and „wir versuchen“ would promise a result of a draw that has not run.
 */
const wunschgegnerAbsatz = (gegner: string): Paragraph => [
  `Als Wunschgegner für den ersten Spieltag haben wir ${gegner} notiert.`,
  "Über die Paarungen entscheidet der Spielplan.",
];

/**
 * The league's dictated wording and its policy towards schools, kept over the rule
 * against calling a performed operation impossible: an administrator's group swap and colour edit are the
 * league's own corrections.
 */
const einteilungAbsatz = (gruppe: string, farbe: string | null): Paragraph =>
  farbe === null
    ? [
        `Wir haben Euch in Gruppe ${gruppe} untergebracht.`,
        "Die Gruppe ist aus organisatorischen Gründen nicht mehr veränderbar.",
        "Eure Trikotfarbe teilen wir Euch noch mit.",
      ]
    : [
        `Wir haben Euch in Gruppe ${gruppe} untergebracht und Euch die Trikotfarbe ${farbe} zugewiesen.`,
        "Beide Angaben sind aus organisatorischen Gründen nicht mehr veränderbar.",
      ];

/**
 * The one page every reader who is waiting on the league can use, named as
 * `BewerbungView.tsx :: KOPF_LINKS` names it.
 */
const ligaAktion = (origin: string) => ({ label: "Laufende Saison", href: `${origin}/dashboard` });

/**
 * Where a school starts again. The id is percent-encoded rather than interpolated raw: it lands in
 * an href, and `escapeHtml` guards an HTML context rather than a URL's own syntax.
 */
const neuBewerbenAktion = (origin: string, saisonId: string) => ({
  label: "Neu bewerben",
  href: `${origin}/bewerbung/${encodeURIComponent(saisonId)}`,
});

/** A deadline as the mails state it; the backend sends the day, and the one German spelling of it is here. */
const fristText = (frist: string): string => formatDatum(frist as CalendarDay);

/** What a mail calls a seat whose person is gone — declined or erased, and outstanding either way. */
const SEAT_OHNE_NAMEN = "Ohne Namen";

/** „{vorname} ({Rollen})“, which is how every mail naming somebody else's seats names them. */
function personName({ vorname, rollen }: FLBewerbungPerson): string {
  return `${vorname ?? SEAT_OHNE_NAMEN} (${rollenText(rollen)})`;
}

/**
 * The reader's own floor, one of the two the confirmation page asks against: a person holding a seat besides the
 * Trainer's is asked the higher one (`fl_backend/app/api/bewerbungen/services.py :: mindestalter_for`).
 */
function altersSatz(rollen: readonly FLBewerbungLinkData["rollen"][number][]): string {
  return rollen.every((rolle) => rolle === "trainer")
    ? `${KONTAKT_ROLLE_LANGFORM.trainer} kann sein, wer mindestens 16 Jahre alt ist.`
    : `${KONTAKT_ROLLE_LANGFORM.ansprechperson} oder ${KONTAKT_ROLLE_LANGFORM.stellvertretung} kann sein, wer mindestens 18 Jahre alt ist.`;
}

/** A fill named by its hex, in this shape alone: no supplier could match any other. */
const FARBE_HEX = /^#[0-9a-f]{6}$/i;

/** What an accepted application is told, each person naming the seats they were entered for. */
export function buildBewerbungZusageEmail(
  { team, saison_id, rollen, gruppe, trikot_farbe, wunschgegner }: FLBewerbungZusageData,
  { origin }: MailOrt,
): Mail {
  const site = mailOrigin(origin);
  // Blank counts as unnamed, so the silence rests on no payload's trim.
  const gegner = (wunschgegner ?? "").trim();
  const farbe = TRIKOT_FARBEN.find((eintrag) => eintrag.value === trikot_farbe);
  const hex = farbe !== undefined && FARBE_HEX.test(farbe.hex) ? farbe.hex : null;

  return {
    art: "mitteilung",
    subjectLine: `Willkommen in der Saison ${saison_id}`,
    origin: site,
    vorname: "",
    paragraphs: [
      [
        `Vielen Dank für Eure Bewerbung für die Saison ${saison_id} der ${BRAND_NAME}.`,
        "Wir freuen uns, Euch mitteilen zu können, dass Eure Bewerbung erfolgreich war.",
        [{ strong: team }, ` ist für die Saison ${saison_id} aufgenommen. Herzlich willkommen!`],
      ],
    ],
    // No row for the decision or the season: the heading states both.
    block: {
      title: `In der Saison ${saison_id}`,
      facts: [
        { label: "Team", value: team },
        { label: "Gruppe", value: gruppe },
        // Stated rather than guessed, and stated as a row either way: an absent colour is a fact the
        // reader has to be able to find in the same place as a named one. The hex beside the name: the name
        // alone leaves neighbours such as Grün and Smaragd for a supplier to guess between.
        { label: "Trikotfarbe", value: farbe === undefined ? "noch nicht festgelegt" : hex === null ? farbe.label : `${farbe.label} (${hex})` },
        // The one row that differs per reader: each person is told the seats they were entered for.
        { label: "Eingetragen als", value: rollenText(rollen) },
      ],
    },
    afterBlock: [einteilungAbsatz(gruppe, farbe?.label ?? null), ...(gegner === "" ? [] : [wunschgegnerAbsatz(gegner)]), websiteSatz(site)],
    button: ligaAktion(site),
  };
}

/** The mail states the decision and the reason it was given, and says that it covers this application rather than the school. */
export function buildBewerbungAbsageEmail({ team, saison_id, rollen, grund }: FLBewerbungAbsageData, { origin }: MailOrt): Mail {
  return {
    art: "mitteilung",
    subjectLine: `Absage für die Saison ${saison_id}`,
    origin: mailOrigin(origin),
    vorname: "",
    paragraphs: [
      [
        ["Danke, dass ", { strong: team }, ` sich für die Saison ${saison_id} der ${BRAND_NAME} beworben hat.`],
        "Für diese Saison können wir das Team nicht aufnehmen.",
      ],
      ["Die Entscheidung betrifft diese Bewerbung, nicht die Schule und nicht die Menschen dahinter."],
    ],
    block: {
      title: "Die Absage",
      facts: [
        { label: "Team", value: team },
        { label: "Saison", value: saison_id },
        // Identification rather than a verdict: it says why the mail reached this reader.
        { label: "Eingetragen als", value: rollenText(rollen) },
        // Unabridged and last: it is the one thing the mail exists to hand over.
        { label: "Angegebener Grund", value: grund },
      ],
    },
  };
}

/** What one person is asked to confirm: every seat they hold, answered through the one link. */
export function buildBewerbungBestaetigungEmail({ saison_id, schule, rollen, frist }: FLBewerbungLinkData, { origin, token }: MailLink): Mail {
  const site = mailOrigin(origin);
  const bis = fristText(frist);

  return {
    art: "erstkontakt",
    subjectLine: `Dein Eintrag für die Saison ${saison_id}`,
    origin: site,
    vorname: "",
    paragraphs: [
      [
        ["Für die Schule ", { strong: schule }, ` wurde eine Bewerbung zur Saison ${saison_id} der ${BRAND_NAME} eingereicht.`],
        `Darin bist Du als ${rollenText(rollen)} eingetragen.`,
        [{ strong: "Bitte bestätige, dass das stimmt" }, ": Erst dann führt die Liga Dich als Kontaktperson."],
      ],
      [
        `Klicke auf den Button. Auf der Seite gibst Du nur Dein Geburtsdatum ein, sonst nichts: ${altersSatz(rollen)}`,
        "Du kannst dem Eintrag auch widersprechen.",
        ["Der Link ist bis zum ", { strong: bis }, " gültig und funktioniert nur einmal."],
      ],
      [
        "Ohne Deine Bestätigung bleibt die Bewerbung unvollständig.",
        "Nach drei Tagen erinnern wir Dich einmal.",
        "Ist die Bewerbung vierzehn Tage nach dem Versand dieses Links noch unvollständig, löschen wir sie mit allen Angaben.",
        "Ersetzen wir später einen Link durch einen neuen, beginnt diese Frist für die ganze Bewerbung von vorn.",
        "Eine Erinnerung verschiebt sie nicht.",
      ],
    ],
    block: {
      title: "Dein Eintrag",
      facts: [
        // Named here and in no mail to the submitter: a contact who never heard of the application
        // has nothing else to tell whose it is, and cannot answer a link they cannot place.
        { label: "Schule", value: schule },
        { label: "Saison", value: saison_id },
        { label: "Eingetragen als", value: rollenText(rollen) },
        { label: "Link gültig bis", value: bis },
      ],
    },
    button: { label: "Eintrag bestätigen", href: kontaktBestaetigungsLink(site, token) },
  };
}

export function buildBewerbungErinnerungEmail({ saison_id, schule, rollen, frist }: FLBewerbungLinkData, { origin, token }: MailLink): Mail {
  const site = mailOrigin(origin);
  const bis = fristText(frist);

  return {
    art: "erstkontakt",
    subjectLine: `Erinnerung: Dein Eintrag für die Saison ${saison_id}`,
    origin: site,
    vorname: "",
    paragraphs: [
      [
        "Vor drei Tagen haben wir Dich gebeten, Deinen Eintrag zu bestätigen:",
        ["In der Bewerbung der Schule ", { strong: schule }, ` zur Saison ${saison_id} bist Du als ${rollenText(rollen)} eingetragen.`],
        [{ strong: "Bis jetzt fehlt Deine Antwort." }],
      ],
      [
        "Klicke auf den Button, gib Dein Geburtsdatum ein und bestätige den Eintrag, oder widersprich ihm.",
        ["Ist die Bewerbung am ", { strong: bis }, " noch unvollständig, löschen wir sie mit allen Angaben."],
      ],
    ],
    block: {
      title: "Dein Eintrag",
      facts: [
        { label: "Schule", value: schule },
        { label: "Saison", value: saison_id },
        { label: "Eingetragen als", value: rollenText(rollen) },
        // The deadline the first mail gave. The erasure runs the day AFTER it
        // (`fl_backend/app/api/bewerbungen/services.py :: deletion_is_due`), so a label naming a
        // deletion date would name a day the clock does not act on.
        { label: "Bestätigen bis", value: bis },
      ],
    },
    // A fresh link, minted beside the first one rather than in place of it: a reminder that voided
    // the link somebody is still looking at would punish the reader it is chasing.
    button: { label: "Eintrag bestätigen", href: kontaktBestaetigungsLink(site, token) },
  };
}

/**
 * What the submitter is told at submission. `ausstehend` names the people still to answer, because the submitter
 * is the one person who can ask a colleague in the corridor; the mail carries the submitter's own link.
 */
export function buildBewerbungEingangEmail(
  { saison_id, rollen, pending: ausstehend, frist }: FLBewerbungReceivedData,
  { origin, token }: MailLink,
): Mail {
  const site = mailOrigin(origin);
  const bis = fristText(frist);

  return {
    art: "mitteilung",
    subjectLine: `Bewerbung eingegangen: Saison ${saison_id}`,
    origin: site,
    vorname: "",
    paragraphs: [
      [
        [`Deine Bewerbung für die Saison ${saison_id} der ${BRAND_NAME} ist `, { strong: "bei uns eingegangen" }, "."],
        "Danke für die Anmeldung Deines Teams.",
      ],
      [
        "Vollständig ist sie, sobald jede Kontaktperson ihren Eintrag selbst bestätigt hat.",
        ["Dazu hat jede von ihnen einen eigenen Link per E-Mail bekommen, Du auch: ", { strong: "Deinen findest Du unten." }],
      ],
      [
        "Nach drei Tagen erinnern wir alle, die noch nicht bestätigt haben.",
        ["Ist die Bewerbung am ", { strong: bis }, " noch unvollständig, löschen wir sie mit allen Angaben und sagen Dir Bescheid."],
        "Sag den anderen am besten selbst Bescheid, dann geht es schneller.",
      ],
    ],
    // The other contacts by first name and role, and no school: a mistyped submitter address then
    // hands a stranger two first names and two roles with nothing to attach them to.
    block: {
      title: "Stand der Bewerbung",
      facts: [
        { label: "Status", value: "Eingegangen, Bestätigungen offen" },
        { label: "Saison", value: saison_id },
        { label: "Eingetragen als", value: rollenText(rollen) },
        { label: "Noch offen", value: formatAufzaehlung(ausstehend.map(personName)) },
        { label: "Frist", value: bis },
      ],
    },
    button: { label: "Meinen Eintrag bestätigen", href: kontaktBestaetigungsLink(site, token) },
  };
}

/**
 * What the submitter is told as the application is deleted. Owed in the erasure's own write and worded in the present,
 * `ausstehend` naming the people the deleted application still held.
 */
export function buildBewerbungGeloeschtEmail({ saison_id, rollen, pending: ausstehend }: FLBewerbungErasureData, { origin }: MailOrt): Mail {
  const site = mailOrigin(origin);

  return {
    art: "mitteilung",
    subjectLine: `Bewerbung wird gelöscht: Saison ${saison_id}`,
    origin: site,
    vorname: "",
    paragraphs: [
      [
        "Die Frist für die Bestätigungen ist abgelaufen, und nicht alle Kontaktpersonen haben ihren Eintrag bestätigt.",
        [`Deshalb löschen wir Deine Bewerbung für die Saison ${saison_id} jetzt `, { strong: "mit allen Angaben" }, ", wie angekündigt."],
      ],
      [
        "Solange die Bewerbungsfrist läuft, kann sich Deine Schule neu bewerben.",
        "Frag die Kontaktpersonen am besten vorher, dann klappt es beim zweiten Mal schneller.",
      ],
    ],
    block: {
      title: "Stand der Bewerbung",
      facts: [
        { label: "Status", value: "Wird gelöscht, nicht vollständig geworden" },
        { label: "Saison", value: saison_id },
        { label: "Eingetragen als", value: rollenText(rollen) },
        // The one thing a school needs before applying again: told only that the application lapsed,
        // they collect the same people and land here a second time.
        { label: "Nicht bestätigt", value: formatAufzaehlung(ausstehend.map(personName)) },
      ],
    },
    button: neuBewerbenAktion(site, saison_id),
  };
}

/** What the submitter is told when a person refuses their entry; `abgelehnt` was read before the decline emptied it. */
export function buildBewerbungWiderspruchEmail(
  { saison_id, rollen, declined: abgelehnt, frist }: FLBewerbungWiderspruchData,
  { origin }: MailOrt,
): Mail {
  const site = mailOrigin(origin);
  const wer = personName(abgelehnt);

  return {
    art: "mitteilung",
    subjectLine: `Widerspruch zum Eintrag: Saison ${saison_id}`,
    origin: site,
    vorname: "",
    paragraphs: [
      // No pronoun, and „Diese Angaben“ where „seine“ or „ihre“ would stand: both read correctly for every name.
      [[{ strong: `${wer} hat dem Eintrag als Kontaktperson widersprochen.` }], "Diese Angaben haben wir aus der Bewerbung entfernt."],
      [
        "So kann die Bewerbung nicht vollständig werden.",
        ["Am ", { strong: fristText(frist) }, " löschen wir sie."],
        "Möchte Deine Schule trotzdem mitspielen, bewirb Dich neu, mit einer anderen Person an ihrer Stelle.",
        "Frag sie vorher.",
      ],
    ],
    block: {
      title: "Stand der Bewerbung",
      facts: [
        { label: "Status", value: "Nicht vollständig, eine Bestätigung fehlt" },
        { label: "Saison", value: saison_id },
        { label: "Eingetragen als", value: rollenText(rollen) },
        { label: "Widerspruch von", value: wer },
      ],
    },
    button: neuBewerbenAktion(site, saison_id),
  };
}
