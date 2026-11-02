import "server-only";

import { KONTAKT_EMAIL } from "./brand";
import { catalogue, COPY } from "./copy";
import { formatDatum, formatNumber } from "./format";

import type { CalendarDay } from "./format";
import type { Code } from "./generated/client/types";
import type { ROUTES } from "./routes";

/** The route keys of the pages a search engine may list. */
type ListedRoute = { [Key in keyof typeof ROUTES]: (typeof ROUTES)[Key]["crawl"] extends "index" ? Key : never }[keyof typeof ROUTES];

// One rule over two codes: a match whose result no play decides carries no goals, on the fixture and in its report.
const NO_TORE = "Nur ohne eingetragene Tore";

/**
 * The catalogue's entries only the server reads, so no client bundle carries them: `COPY` is one object, and a
 * bundler keeps all of an object a client module imports. Branded as `COPY` is, so an entry passes wherever a `Copy`
 * is asked for.
 */
export const SERVER_COPY = catalogue({
  /**
   * A refusal's own phrase, by the backend's code, for a code a person causes knowingly from a screen; every other
   * code answers one of the shared failure lines `COPY.shared.failure` holds. A refusal about one field shows on it,
   * in the field patterns' form, or, where the screen shows no box for it, on the status line after the field's name.
   */
  refusal: {
    duplicate_key: COPY.shared.field.taken,
    spiel_outside_spieltag: "Außerhalb des Spieltags",
    state_ergebnis_on_a_non_event: NO_TORE,
    state_nichtantreten_without_two_sides: "Nur mit beiden Teams",
    booking_unknown_resource: "Stillgelegt oder gelöscht",
    booking_unconfirmed_schiedsrichter: "Noch nicht bestätigt",
    spiel_double_booked: "Zu dieser Zeit schon eingeteilt",
    eligibility_disqualified: "Aus der Saison ausgeschieden",
  } satisfies Partial<Record<Code, string>>,

  /**
   * A rule's own phrase, in the field patterns' form, by the kind the backend refuses a payload with
   * (`fields[].kind`), for a rule a person can break that no field pattern words: placed as `refusal` places a code.
   * Every other rule is worded from the patterns by `fl_frontend/src/core/ruleMessage.ts :: ruleMessage`.
   */
  rule: {
    elfmeterschiessen_without_winner: "Nur mit Sieger",
    nichtantreten_with_tore: NO_TORE,
    nichtantreten_with_torschuetzen: "Nur ohne Torschützen",
    elfmeterschiessen_without_draw: "Nur nach Unentschieden",
    torschuetzen_not_matching_tore: "Ein Eintrag je Tor",
  },

  /** The mail shell's own lines; each mail's sentences are its template's until its area's session rewrites them. */
  mail: {
    /** The one greeting: the first name where it is known. */
    greeting: (vorname: string) => (vorname === "" ? "Hallo," : `Hallo ${vorname},`),
    /** Under the button, above its link printed to copy. */
    buttonLink: "Falls der Knopf nicht geht, öffne diesen Link:",
    /**
     * The Art. 21 DSGVO objection, set apart from the rest as Art. 21 (4) asks, in the two parts around the league's
     * address, which the shell sets as a link between them.
     */
    objection: {
      before:
        "Du kannst der Verarbeitung deiner Angaben jederzeit widersprechen, aus Gründen, die sich aus deiner besonderen Situation ergeben (Art. 21 DSGVO). Eine formlose E-Mail an",
      after: "genügt.",
    },
    /** The mail's last line, by its kind: what a reader the mail was not meant for does. */
    notYou: {
      signIn: "Du hast keinen Code angefordert? Dann ignoriere diese E-Mail.",
      security: "Warst du das nicht? Dann antworte sofort auf diese E-Mail.",
      firstContact: "Du weißt nichts davon? Dann antworte auf diese E-Mail, und wir löschen deine Angaben.",
    },
  },

  /**
   * The landing's sections, the blocks About and Kontakt share with it, and the classic frame's not-found page,
   * each read by a Server Component. Every entry is a draft for the landing board.
   */
  landing: {
    // Board: the owner's to word, proposed there with options (K260); today's landing words stand until then.
    tagline: "Frankfurts Oberstufenliga. Wer holt sich den Titel?",
    // Board: the owner corrects it there (D291); today's About words stand until then.
    aboutParagraph:
      "Die Finanzierung unserer Abschlussfeiern und Abibälle. Wir organisieren dafür einen stadtweiten Ligabetrieb im Großfeldfußball. Jedes Spiel bringt durch Ticket- und Cateringverkäufe direkte Einnahmen für beide Jahrgänge.",
    lead: "Frankfurter Schulen, eine Saison, ein Titel. Abi-Jahrgänge spielen 11 gegen 11 auf dem Großfeld, und jedes Spiel bringt Einnahmen für die Abibälle beider Jahrgänge.",
    /** The hero's second act and the band's: applying while a window is open, the league's own page while none is. */
    apply: "Schule bewerben",
    applyNow: "Jetzt bewerben",
    aboutLeague: "Über die Liga",

    pillars: {
      eyebrow: "Unser Ziel",
      title: "Fußball, der den Abiball bezahlt",
      whoPlays: {
        title: "Wer spielt",
        text: "Nur Schülerinnen und Schüler des Abi-Jahrgangs, für den das Team antritt. Mädchen- und gemischte Teams sind willkommen, Lehrer nur als Fans an der Seitenlinie.",
      },
      howPlayed: {
        title: "Wie gespielt wird",
        text: "11 gegen 11, zwei Hälften zu 45 Minuten, bei jedem Wetter. Die Schiedsrichter kommen, wo es geht, von außerhalb.",
      },
      whatFor: {
        title: "Wofür",
        text: "Beide Teams verdienen an Tickets und an ihren Verkäufen vor Ort. Der Erlös wird nach dem Spiel geteilt, in der Regel je zur Hälfte. Der Gewinner bekommt das meiste Geld, dazu Ruhm und Ehre.",
      },
    },

    /** How a school joins: four numbered steps, and the band under them. */
    join: {
      eyebrow: "Bewerbung",
      title: "So kommt deine Schule in die Liga",
      apply: {
        title: "Bewerbung abschicken",
        text: "Solange das Fenster offen ist: Schule und Stufengröße, drei Kontaktpersonen, Wunschfarbe und voraussichtliche Kadergröße.",
      },
      confirm: {
        title: "Kontaktpersonen bestätigen",
        text: "Jede der drei Personen bekommt einen Link und bestätigt ihren Eintrag selbst, innerhalb von 14 Tagen.",
      },
      accept: {
        title: "Zusage der Liga",
        text: "Wir prüfen die Bewerbung und sagen zu oder ab. Mit der Zusage ist deine Schule Teil der Saison.",
      },
      register: {
        title: "Spieler registrieren",
        text: "Dein Team bekommt einen Link, über den sich die Spielerinnen und Spieler registrieren. Die Kontaktpersonen nehmen sie in den Kader auf.",
      },
      /** The band: the open window's deadline, or the word that none is open. */
      open: (saison: string, until: CalendarDay) => `Bewerbungen für die Saison ${saison} bis ${formatDatum(until)}`,
      closed: "Die Bewerbungen sind gerade geschlossen.",
    },

    /** How a season runs: the numbered dotted line. */
    season: {
      eyebrow: "Spielbetrieb",
      title: "So läuft eine Saison",
      gruppenphase: {
        title: "Gruppenphase",
        text: "Die Teams spielen in Gruppen jeder gegen jeden. Nur diese Spiele zählen für die Tabelle, und die Besten jeder Gruppe kommen weiter.",
      },
      viertelfinale: { title: "Viertelfinale", text: "Acht Teams. Bei Gleichstand entscheidet das Elfmeterschießen." },
      halbfinale: { title: "Halbfinale", text: "Vier Teams, zwei Spiele. Die Verlierer spielen um Platz 3." },
      finale: { title: "Finale und Spiel um Platz 3", text: "Größer aufgezogen als jedes Gruppenspiel." },
    },

    figures: {
      title: "Die Liga in Zahlen",
      schools: "Schulen",
      players: "Spielerinnen und Spieler",
      spiele: "Spiele",
      spieltage: "Spieltage",
    },

    organisers: { eyebrow: "Organisation", title: "Wer dahintersteht" },

    /** The ways in: the school's while a window is open, and the question's; the heading counts them. */
    doors: {
      eyebrow: "Mitmachen",
      title: (withSchool: boolean) => (withSchool ? "Zwei Wege zu uns" : "Wege zu uns"),
      school: {
        title: "Deine Schule will antreten",
        text: (saison: string, until: CalendarDay) =>
          `Die Bewerbungen für die Saison ${saison} sind offen bis ${formatDatum(until)}. Deine Schule braucht eine Stufe, drei Kontaktpersonen und ein Team.`,
      },
      question: {
        title: "Du hast eine Frage",
        text: "Zum Spielbetrieb, zu einer Bewerbung oder zur Liga: Schreib uns. Wir melden uns schnellstmöglich.",
      },
    },

    schools: { eyebrow: "Wer dabei ist", title: (saison: string) => `Die Schulen der Saison ${saison}`, all: "Alle Teams" },

    /** The season card beside the hero, in its three states. */
    saison: {
      kickoff: (when: string) => `Anpfiff ${when}`,
      windowUntil: (until: CalendarDay) => `Bewerbungen bis ${formatDatum(until)}`,
      last: "Zuletzt",
      next: "Als Nächstes",
      place: (platz: number) => `${formatNumber(platz)}. Platz`,
      toSpielplan: "Zum Spielplan",
    },

    /** Kontakt's rows, and the question door's links. */
    contact: {
      email: "E-Mail",
      address: KONTAKT_EMAIL,
    },

    /** The classic frame's not-found page. */
    notFound: { title: "Seite nicht gefunden", sentence: "Die Seite wurde verschoben oder gelöscht, oder die Adresse stimmt nicht." },
  },

  /** The kit's season blocks, drawn on the server alone: the Tabelle's groups and the K.-o.-Baum's rows. */
  season: {
    /** One group's table on the Tabelle. */
    gruppe: (gruppe: string) => `Gruppe ${gruppe}`,
    /** The match between the two semi-finals' losers, on its own row above the Finale. */
    thirdPlace: "Spiel um Platz 3",
    /** Where a club stands, under its name in a match head, linking to its row on the Tabelle. */
    standing: (platz: number, gruppe: string) => `${formatNumber(platz)}. Platz · Gruppe ${gruppe}`,
  },

  /**
   * Each listed page's meta description, by its route key, as a search result shows it under the title. Exactly
   * one for every row `ROUTES` lists and none for any other: a signed-in page, a sign-in page or one a mail opens
   * carries none, and a description set nowhere is not inherited from the root either.
   */
  description: {
    home: COPY.brand.description,
    about: "Wer in der Frankfurt League spielt, nach welchen Regeln und wofür, und wer die Liga organisiert.",
    spielplan: (saison: string) => `Alle Spiele der Saison ${saison} der Frankfurt League, Spieltag für Spieltag, mit Datum, Uhrzeit und Ort.`,
    tabelle: (saison: string) => `Die Tabelle der Saison ${saison} der Frankfurt League: jede Gruppe mit Spielen, Toren und Punkten.`,
    teams: (saison: string) => `Alle Teams der Saison ${saison} der Frankfurt League, mit Gruppe und Kader.`,
    team: (team: string, saison: string) => `${team} in der Saison ${saison} der Frankfurt League: Stand, Spiele und Kader.`,
    kORunde: (saison: string) => `Die K.-o.-Runde der Saison ${saison} der Frankfurt League: der K.-o.-Baum bis zum Finale.`,
    spielSearch: (saison: string) => `Alle Spiele der Saison ${saison} der Frankfurt League zum Suchen und Filtern.`,
    spiel: (heim: string, gast: string, saison: string) =>
      `${heim} gegen ${gast} in der Saison ${saison} der Frankfurt League: Termin, Ort, Ergebnis und Aufstellungen.`,
    contact: "Die Frankfurt League erreichst du per E-Mail, auf Instagram und auf Threads.",
    sponsors: "Die Sponsoren der Frankfurt League, und wie du die Liga unterstützen kannst.",
    legalNotice: "Anbieterkennzeichnung der Frankfurt League nach § 5 DDG und § 18 Abs. 2 MStV.",
    privacyNotice: "Welche Daten die Frankfurt League verarbeitet, auf welcher Grundlage und wie lange.",
  } satisfies Record<ListedRoute, string | ((...names: never) => string)>,
});
