import "server-only";

import { BRAND_NAME, mailOrigin } from "./emailShell";
import { joinUnd } from "./joinUnd";

import type { Absatz, Fakt, Mail } from "./emailShell";

/**
 * Future tense because it has to be: a club is entered only while its season is `future`
 * (`REQ-ENTER-001`), and `future` is the one status the public tier is refused
 * (`fl_backend/app/api/saisons/services.py :: WITHHELD_FROM_BASE_TIER`).
 */
const websiteSatz = (site: string): Absatz => [
  ["Spielplan, Tabelle und Ergebnisse veröffentlichen wir auf ", { url: site }, ", sobald die Saison startet."],
];

/**
 * A wish answered as one. The Spielplan is drawn after the decision, so nothing here knows whether it
 * can be met, and „wir versuchen“ would promise a result of a draw that has not run.
 */
const wunschgegnerAbsatz = (gegner: string): Absatz => [
  `Als Wunschgegner für den ersten Spieltag haben wir ${gegner} notiert.`,
  "Über die Paarungen entscheidet der Spielplan.",
];

/**
 * The league's dictated wording and its policy towards schools, kept over the rule
 * against calling a performed operation impossible: an administrator's group swap and colour edit are the
 * league's own corrections.
 */
const einteilungAbsatz = (gruppe: string, farbe: string | null): Absatz =>
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

/**
 * What an accepted application is told. `gruppe`, `trikotFarbeLabel`, `trikotFarbeHex` and `rollenText` arrive rendered
 * because their vocabularies live in `fl_frontend/src/features/`, which `core` may not import
 * (`eslint.config.mjs :: LAYER_BOUNDARY`).
 */
export interface BewerbungZusageData {
  teamName: string;
  saisonId: string;
  origin: string;
  /** The seats THIS reader holds, already one German phrase: one person can hold two, and gets one message naming both. */
  rollenText: string;
  gruppe: string;
  /** Absent while no kit colour has been assigned; the message then states that rather than guessing one. */
  trikotFarbeLabel: string | null;
  /**
   * That colour's hex from the league's colour sheet (`fl_frontend/src/features/teams/constants.ts :: TRIKOT_FARBE_OPTIONS`),
   * `null` with the label: the name alone leaves neighbours such as Grün and Smaragd for a supplier to guess between.
   */
  trikotFarbeHex: string | null;
  /**
   * `null` where the school named none, and the message then says nothing: a draw that has not run can promise nothing.
   * Required: an optional key a call site leaves out compiles, and mails the message without its sentence.
   */
  wunschgegner: string | null;
}

/** What a declined application is told. `grund` is the administrator's own wording, carried verbatim. */
export interface BewerbungAbsageData {
  teamName: string;
  saisonId: string;
  origin: string;
  /** As on the acceptance, and for the same reason: a reader has to be able to place a message before reading it. */
  rollenText: string;
  grund: string;
}

/** A fill named by its hex, in this shape alone: no supplier could match any other. */
const FARBE_HEX = /^#[0-9a-f]{6}$/i;

export function buildBewerbungZusageEmail({
  teamName,
  saisonId,
  origin,
  rollenText,
  gruppe,
  trikotFarbeLabel,
  trikotFarbeHex,
  wunschgegner,
}: BewerbungZusageData): Mail {
  const site = mailOrigin(origin);
  // Blank counts as unnamed, so the silence rests on no payload's trim.
  const gegner = (wunschgegner ?? "").trim();
  const hex = trikotFarbeLabel !== null && trikotFarbeHex !== null && FARBE_HEX.test(trikotFarbeHex) ? trikotFarbeHex : null;

  return {
    art: "mitteilung",
    betreff: `Willkommen in der Saison ${saisonId}`,
    origin: site,
    vorname: "",
    absaetze: [
      [
        `Vielen Dank für Eure Bewerbung für die Saison ${saisonId} der ${BRAND_NAME}.`,
        "Wir freuen uns, Euch mitteilen zu können, dass Eure Bewerbung erfolgreich war.",
        [{ stark: teamName }, ` ist für die Saison ${saisonId} aufgenommen. Herzlich willkommen!`],
      ],
    ],
    // No row for the decision or the season: the heading states both.
    block: {
      fakten: [
        { label: "Team", wert: teamName },
        { label: "Gruppe", wert: gruppe },
        // Stated rather than guessed, and stated as a row either way: an absent colour is a fact the
        // reader has to be able to find in the same place as a named one.
        { label: "Trikotfarbe", wert: hex === null ? (trikotFarbeLabel ?? "noch nicht festgelegt") : `${trikotFarbeLabel ?? ""} (${hex})` },
        // The one row that differs per reader: three people get this message and each is told the seat
        // they were entered for.
        { label: "Eingetragen als", wert: rollenText },
      ],
    },
    nachBlock: [einteilungAbsatz(gruppe, trikotFarbeLabel), ...(gegner === "" ? [] : [wunschgegnerAbsatz(gegner)]), websiteSatz(site)],
    aktion: ligaAktion(site),
  };
}

/** The message states the decision and the reason it was given, and says that it covers this application rather than the school. */
export function buildBewerbungAbsageEmail({ teamName, saisonId, origin, rollenText, grund }: BewerbungAbsageData): Mail {
  return {
    art: "mitteilung",
    betreff: `Absage für die Saison ${saisonId}`,
    origin: mailOrigin(origin),
    vorname: "",
    absaetze: [
      [
        ["Danke, dass ", { stark: teamName }, ` sich für die Saison ${saisonId} der ${BRAND_NAME} beworben hat.`],
        "Für diese Saison können wir das Team nicht aufnehmen.",
      ],
      ["Die Entscheidung betrifft diese Bewerbung, nicht die Schule und nicht die Menschen dahinter."],
    ],
    block: {
      fakten: [
        { label: "Team", wert: teamName },
        { label: "Saison", wert: saisonId },
        // Identification rather than a verdict: it says why the message reached this reader.
        { label: "Eingetragen als", wert: rollenText },
        // Unabridged and last: it is the one thing the message exists to hand over.
        { label: "Angegebener Grund", wert: grund },
      ],
    },
  };
}

/** One seat, as a message names it to somebody who is not sitting in it. */
export interface BewerbungSeat {
  readonly vorname: string;
  /**
   * `fl_frontend/src/features/bewerbungen/constants.ts :: BEWERBUNG_SEATS`'s `label`, which that
   * file maps from `fl_frontend/src/features/teams/constants.ts :: KONTAKT_ROLLEN`'s `langform`.
   * Rendered by the caller because `core` may not import `features`
   * (`fl_frontend/eslint.config.mjs :: LAYER_BOUNDARY`).
   */
  readonly rolleText: string;
}

/** A seat and the link that answers for it. */
export interface BewerbungLinkSeat extends BewerbungSeat {
  /** The finished absolute URL. The token inside it is a bearer credential and is never taken apart here. */
  readonly link: string;
}

/**
 * What one MAILBOX is asked to confirm. `seats` holds one entry per link that mailbox was sent, so
 * two people sharing a school inbox arrive as two entries and one person holding two seats under a
 * single link as one.
 */
export interface BewerbungBestaetigungData {
  saisonId: string;
  origin: string;
  schule: string;
  /* At least one, in the type: an empty list renders an empty fact row and no link to answer with. */
  seats: readonly [BewerbungLinkSeat, ...BewerbungLinkSeat[]];
  /**
   * The deadline as a German date, rendered by the caller for the reason `rollenText` is:
   * `fl_frontend/src/shared/utils/format.ts :: formatSpielDatum` sits in a layer `core` may not reach.
   */
  fristText: string;
}

/** „{vorname} ({rolle})“, which is how every message naming somebody else's seat names it. */
function seatName({ vorname, rolleText }: BewerbungSeat): string {
  return `${vorname} (${rolleText})`;
}

/** The plural form names whose each row is; the singular one has nobody to tell its reader apart from. */
function seatFakten(seats: BewerbungBestaetigungData["seats"]): Fakt[] {
  if (seats.length < 2) return [{ label: "Eingetragen als", wert: seats[0].rolleText }];

  return seats.map((seat) => ({ label: "Eingetragen als", wert: seatName(seat) }));
}

/** One seat's link is the button; several share no button, each link printed under its seat's name. */
function seatAktion(seats: BewerbungBestaetigungData["seats"]): NonNullable<Mail["aktion"]> {
  if (seats.length < 2) return { label: "Eintrag bestätigen", href: seats[0].link };

  return { links: seats.map((seat) => ({ name: seatName(seat), href: seat.link })) };
}

/**
 * **Both floors, never the reader's own**: `seats` is one entry per LINK, so a shared school inbox
 * holding two people arrives as one message under two floors, and one figure would be wrong for one.
 */
const ALTERS_SATZ =
  "Trainerin oder Trainer kann sein, wer mindestens 16 Jahre alt ist. Ansprechperson oder Stellvertretung kann sein, wer mindestens 18 Jahre alt ist.";

export function buildBewerbungBestaetigungEmail({ saisonId, origin, schule, seats, fristText }: BewerbungBestaetigungData): Mail {
  const mehrere = seats.length > 1;

  return {
    art: "erstkontakt",
    betreff: mehrere ? `Eure Einträge für die Saison ${saisonId}` : `Dein Eintrag für die Saison ${saisonId}`,
    origin: mailOrigin(origin),
    vorname: "",
    absaetze: [
      [
        ["Für die Schule ", { stark: schule }, ` wurde eine Bewerbung zur Saison ${saisonId} der ${BRAND_NAME} eingereicht.`],
        mehrere
          ? `Mit dieser E-Mail-Adresse sind darin ${joinUnd(seats.map(seatName))} eingetragen.`
          : `Darin bist Du als ${seats[0].rolleText} eingetragen.`,
        mehrere
          ? [{ stark: "Bitte bestätigt jeden Eintrag einzeln" }, ": Erst dann führt die Liga Euch als Kontaktpersonen."]
          : [{ stark: "Bitte bestätige, dass das stimmt" }, ": Erst dann führt die Liga Dich als Kontaktperson."],
      ],
      [
        // Links, not buttons, where several seats share the mailbox: the shell draws one button at most.
        mehrere
          ? `Öffnet diese Links und gebt dort nur Euer Geburtsdatum ein, sonst nichts: ${ALTERS_SATZ}`
          : `Klicke auf den Button. Auf der Seite gibst Du nur Dein Geburtsdatum ein, sonst nichts: ${ALTERS_SATZ}`,
        mehrere ? "Jedem Eintrag lässt sich auch widersprechen." : "Du kannst dem Eintrag auch widersprechen.",
        [mehrere ? "Jeder Link ist bis zum " : "Der Link ist bis zum ", { stark: fristText }, " gültig und funktioniert nur einmal."],
      ],
      [
        mehrere ? "Ohne Eure Bestätigungen bleibt die Bewerbung unvollständig." : "Ohne Deine Bestätigung bleibt die Bewerbung unvollständig.",
        mehrere ? "Nach drei Tagen erinnern wir Euch einmal." : "Nach drei Tagen erinnern wir Dich einmal.",
        `Ist die Bewerbung vierzehn Tage nach dem Versand ${mehrere ? "dieser Links" : "dieses Links"} noch unvollständig, löschen wir sie mit allen Angaben.`,
        "Ersetzen wir später einen Link durch einen neuen, beginnt diese Frist für die ganze Bewerbung von vorn.",
        "Eine Erinnerung verschiebt sie nicht.",
      ],
    ],
    block: {
      fakten: [
        // Named here and in no message to the submitter: a contact who never heard of the application
        // has nothing else to tell whose it is, and cannot answer a link they cannot place.
        { label: "Schule", wert: schule },
        { label: "Saison", wert: saisonId },
        ...seatFakten(seats),
        { label: mehrere ? "Links gültig bis" : "Link gültig bis", wert: fristText },
      ],
    },
    aktion: seatAktion(seats),
  };
}

export function buildBewerbungErinnerungEmail({ saisonId, origin, schule, seats, fristText }: BewerbungBestaetigungData): Mail {
  const mehrere = seats.length > 1;

  return {
    art: "erstkontakt",
    betreff: mehrere ? `Erinnerung: Eure Einträge für die Saison ${saisonId}` : `Erinnerung: Dein Eintrag für die Saison ${saisonId}`,
    origin: mailOrigin(origin),
    vorname: "",
    absaetze: [
      [
        mehrere
          ? "Vor drei Tagen haben wir Euch gebeten, Eure Einträge zu bestätigen:"
          : "Vor drei Tagen haben wir Dich gebeten, Deinen Eintrag zu bestätigen:",
        mehrere
          ? [
              "In der Bewerbung der Schule ",
              { stark: schule },
              ` zur Saison ${saisonId} sind mit dieser E-Mail-Adresse ${joinUnd(seats.map(seatName))} eingetragen.`,
            ]
          : ["In der Bewerbung der Schule ", { stark: schule }, ` zur Saison ${saisonId} bist Du als ${seats[0].rolleText} eingetragen.`],
        [{ stark: mehrere ? "Bis jetzt fehlt Eure Antwort." : "Bis jetzt fehlt Deine Antwort." }],
      ],
      [
        mehrere
          ? "Öffnet diese Links, gebt Euer Geburtsdatum ein und bestätigt die Einträge, oder widersprecht ihnen."
          : "Klicke auf den Button, gib Dein Geburtsdatum ein und bestätige den Eintrag, oder widersprich ihm.",
        ["Ist die Bewerbung am ", { stark: fristText }, " noch unvollständig, löschen wir sie mit allen Angaben."],
      ],
    ],
    block: {
      fakten: [
        { label: "Schule", wert: schule },
        { label: "Saison", wert: saisonId },
        ...seatFakten(seats),
        // The deadline the first message gave. The erasure runs the day AFTER it
        // (`fl_backend/app/api/bewerbungen/services.py :: deletion_is_due`), so a label naming a
        // deletion date would name a day the clock does not act on.
        { label: "Bestätigen bis", wert: fristText },
      ],
    },
    // Fresh links, minted beside the first ones rather than in place of them: a reminder that voided
    // the link somebody is still looking at would punish the reader it is chasing.
    aktion: seatAktion(seats),
  };
}

/**
 * What the submitter is told at submission, once every contact has been written to. `ausstehend` is
 * the caller's list of seats still waiting, named because the submitter is the one person who can
 * ask a colleague in the corridor.
 */
export interface BewerbungEingangOffenData {
  saisonId: string;
  origin: string;
  rollenText: string;
  ausstehend: readonly BewerbungSeat[];
  fristText: string;
  /** The submitter's own link: they hold a seat like the other two and confirm it from this message. */
  link: string;
}

export function buildBewerbungEingangOffenEmail({
  saisonId,
  origin,
  rollenText,
  ausstehend,
  fristText,
  link,
}: BewerbungEingangOffenData): Mail {
  return {
    art: "mitteilung",
    betreff: `Bewerbung eingegangen: Saison ${saisonId}`,
    origin: mailOrigin(origin),
    vorname: "",
    absaetze: [
      [
        [`Deine Bewerbung für die Saison ${saisonId} der ${BRAND_NAME} ist `, { stark: "bei uns eingegangen" }, "."],
        "Danke für die Anmeldung Deines Teams.",
      ],
      [
        "Vollständig ist sie, sobald jede Kontaktperson ihren Eintrag selbst bestätigt hat.",
        ["Dazu hat jede von ihnen einen eigenen Link per E-Mail bekommen, Du auch: ", { stark: "Deinen findest Du unten." }],
      ],
      [
        "Nach drei Tagen erinnern wir alle, die noch nicht bestätigt haben.",
        ["Ist die Bewerbung am ", { stark: fristText }, " noch unvollständig, löschen wir sie mit allen Angaben und sagen Dir Bescheid."],
        "Sag den anderen am besten selbst Bescheid, dann geht es schneller.",
      ],
    ],
    // The other contacts by first name and role, and no school: a mistyped submitter address then
    // hands a stranger two first names and two roles with nothing to attach them to.
    block: {
      fakten: [
        { label: "Status", wert: "Eingegangen, Bestätigungen offen" },
        { label: "Saison", wert: saisonId },
        { label: "Eingetragen als", wert: rollenText },
        { label: "Noch offen", wert: joinUnd(ausstehend.map(seatName)) },
        { label: "Frist", wert: fristText },
      ],
    },
    aktion: { label: "Meinen Eintrag bestätigen", href: link },
  };
}

/**
 * What the submitter is told as the application is deleted. The message goes out BEFORE the erasure
 * and is worded in the present for that reason, `ausstehend` naming seats the document still holds.
 */
export interface BewerbungGeloeschtData {
  saisonId: string;
  origin: string;
  rollenText: string;
  ausstehend: readonly BewerbungSeat[];
}

export function buildBewerbungGeloeschtEmail({ saisonId, origin, rollenText, ausstehend }: BewerbungGeloeschtData): Mail {
  const site = mailOrigin(origin);

  return {
    art: "mitteilung",
    betreff: `Bewerbung wird gelöscht: Saison ${saisonId}`,
    origin: site,
    vorname: "",
    absaetze: [
      [
        "Die Frist für die Bestätigungen ist abgelaufen, und nicht alle Kontaktpersonen haben ihren Eintrag bestätigt.",
        [`Deshalb löschen wir Deine Bewerbung für die Saison ${saisonId} jetzt `, { stark: "mit allen Angaben" }, ", wie angekündigt."],
      ],
      [
        "Solange die Bewerbungsfrist läuft, kann sich Deine Schule neu bewerben.",
        "Frag die Kontaktpersonen am besten vorher, dann klappt es beim zweiten Mal schneller.",
      ],
    ],
    block: {
      fakten: [
        { label: "Status", wert: "Wird gelöscht, nicht vollständig geworden" },
        { label: "Saison", wert: saisonId },
        { label: "Eingetragen als", wert: rollenText },
        // The one thing a school needs before applying again: told only that the application lapsed,
        // they collect the same people and land here a second time.
        { label: "Nicht bestätigt", wert: joinUnd(ausstehend.map(seatName)) },
      ],
    },
    aktion: neuBewerbenAktion(site, saisonId),
  };
}

/**
 * What the submitter is told when a contact refuses the seat. `abgelehnt` is composed before that
 * seat's details are cleared, the first name being what the message exists to hand over.
 */
export interface BewerbungWiderspruchData {
  saisonId: string;
  origin: string;
  rollenText: string;
  abgelehnt: BewerbungSeat;
  fristText: string;
}

export function buildBewerbungWiderspruchEmail({ saisonId, origin, rollenText, abgelehnt, fristText }: BewerbungWiderspruchData): Mail {
  const site = mailOrigin(origin);
  const wer = seatName(abgelehnt);

  return {
    art: "mitteilung",
    betreff: `Widerspruch zum Eintrag: Saison ${saisonId}`,
    origin: site,
    vorname: "",
    absaetze: [
      // No pronoun, and „Diese Angaben“ where „seine“ or „ihre“ would stand: both read correctly for every name.
      [[{ stark: `${wer} hat dem Eintrag als Kontaktperson widersprochen.` }], "Diese Angaben haben wir aus der Bewerbung entfernt."],
      [
        "So kann die Bewerbung nicht vollständig werden.",
        ["Am ", { stark: fristText }, " löschen wir sie."],
        "Möchte Deine Schule trotzdem mitspielen, bewirb Dich neu, mit einer anderen Person an ihrer Stelle.",
        "Frag sie vorher.",
      ],
    ],
    block: {
      fakten: [
        { label: "Status", wert: "Nicht vollständig, eine Bestätigung fehlt" },
        { label: "Saison", wert: saisonId },
        { label: "Eingetragen als", wert: rollenText },
        { label: "Widerspruch von", wert: wer },
      ],
    },
    aktion: neuBewerbenAktion(site, saisonId),
  };
}
