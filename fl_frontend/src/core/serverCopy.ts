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
   * The landing's sections, the blocks About, Kontakt and the sponsors page share with it, and the classic frame's
   * not-found page, each read by a Server Component.
   */
  landing: {
    /** The hero's one heading (K260, D481). */
    tagline: "Frankfurts Abi-Jahrgänge spielen um den Titel",
    /** The one paragraph the league describes itself with, under the tagline and at the head of About (K260, D291). */
    paragraph: `${COPY.brand.description} Ehrenamtliche aus den Jahrgängen organisieren die Liga.`,
    /** The way to apply while a window is open: the hero's second act, the steps' band and the school's door (D481). */
    toBewerbung: "Zur Bewerbung",

    /** What About tells in short sections, each written once: the landing's pillars and its small cards read them too. */
    about: {
      who: {
        title: "Wer spielt",
        text: "Nur der Abi-Jahrgang, für den das Team antritt, in jeder Zusammensetzung. Lehrkräfte sind als Fans willkommen.",
      },
      rules: {
        title: "Die Regeln",
        text: "11 gegen 11 über 90 Minuten, bei jedem Wetter. Die Schiedsrichter kommen, soweit möglich, von außerhalb.",
      },
      purpose: { title: "Wofür", text: "Beide Teams verdienen an Tickets und am Verkauf vor Ort und teilen den Erlös." },
      spielorte: { title: "Spielorte", text: "Kein zentraler Platz. Wo und wann ein Spiel stattfindet, steht im Spielplan." },
      admission: { title: "Eintritt", text: "2 bis 5 €, je nach Spiel. Im Vorverkauf meist günstiger." },
      safety: { title: "Sicherheit", text: "Bei den meisten Spielen sind Sanitäter vor Ort." },
    },

    pillars: { eyebrow: "Unser Ziel", title: "Fußball, der den Abiball bezahlt" },

    /** How a school joins: four numbered steps, and the band under them. */
    join: {
      eyebrow: "Bewerbung",
      title: "Der Weg in die Liga",
      apply: {
        title: "Bewerbung abschicken",
        text: "Schule, Stufe, 3 Kontaktpersonen und die geplante Kadergröße, solange das Fenster offen ist.",
      },
      confirm: {
        title: "Kontaktpersonen bestätigen",
        text: (days: number) => `Jede der 3 Personen bekommt einen Link und bestätigt ihren Eintrag innerhalb von ${formatNumber(days)} Tagen.`,
      },
      decision: {
        title: "Zusage der Liga",
        text: "Wir prüfen die Bewerbung und sagen zu oder ab. Mit der Zusage ist deine Schule Teil der Saison.",
      },
      register: {
        title: "Spieler registrieren",
        text: "Dein Team bekommt einen Link, über den sich dein Jahrgang registriert. Die Kontaktpersonen nehmen die Spieler in den Kader auf.",
      },
      /** The band: the open window's deadline, or the word that none is open. */
      open: (saison: string, until: CalendarDay) => `Bewerbungen für die Saison ${saison} bis ${formatDatum(until)}`,
      closed: "Das Bewerbungsfenster ist geschlossen.",
    },

    /** How a season runs: the numbered dotted line, worded so it holds for any number of groups and rounds. */
    season: {
      eyebrow: "Spielbetrieb",
      title: "So läuft eine Saison",
      gruppenphase: {
        title: "Gruppenphase",
        text: "Die Teams spielen in Gruppen jeder gegen jeden. Nur diese Spiele zählen für die Tabelle, und die Besten jeder Gruppe kommen weiter.",
      },
      kORunde: { title: COPY.shared.kORunde, text: "Wer verliert, scheidet aus. Bei Gleichstand entscheidet das Elfmeterschießen." },
      platz3: { title: "Spiel um Platz 3", text: "Die beiden Verlierer der Halbfinale spielen um Platz 3." },
      finale: { title: "Finale", text: "Das Spiel um den Titel." },
    },

    /** The season in four counts. */
    figures: {
      title: (saison: string) => `Saison ${saison} in Zahlen`,
      schulen: "Schulen",
      tore: "Tore",
      spiele: COPY.page.spiele,
      spieltage: "Spieltage",
    },

    organisers: {
      eyebrow: "Organisation",
      title: "Wer dahintersteht",
      /** What each organiser does, under their first name. */
      role: { vorstand: "Vorstand", spielbetrieb: "Spielbetrieb", website: "Website", kommunikation: "Kommunikation" },
    },

    /** The ways in: the school's while a window is open, and the question's; the heading counts them. */
    doors: {
      eyebrow: "Mitmachen",
      title: (withSchool: boolean) => (withSchool ? "Zwei Wege zu uns" : "Wege zu uns"),
      school: { title: "Deine Schule will antreten" },
      question: {
        title: "Du hast eine Frage",
        text: "Zum Spielbetrieb, zu einer Bewerbung oder zur Liga: Schreib uns. Wir melden uns schnellstmöglich.",
      },
      /** The sponsors page's door, under its tiles. */
      support: "Du willst die Liga unterstützen",
    },

    schools: { eyebrow: "Wer dabei ist", title: (saison: string) => `Schulen der Saison ${saison}` },

    /** The season card beside the hero, in its states. */
    saison: {
      kickoff: (when: string) => `Anpfiff ${when}`,
      /** The opening match's matchday, before its two plaques. */
      spieltag: (position: number) => `${formatNumber(position)}. Spieltag`,
      windowUntil: (until: CalendarDay) => `Bewerbungen bis ${formatDatum(until)}`,
      undated: "Der erste Spieltag ist noch nicht angesetzt.",
      last: "Zuletzt",
      next: "Als Nächstes",
      place: (platz: number) => `${formatNumber(platz)}. Platz`,
      toSpielplan: "Zum Spielplan",
    },

    /** Kontakt's rows, and the doors' links. */
    contact: {
      email: "E-Mail",
      address: KONTAKT_EMAIL,
    },

    /** The classic frame's not-found page. */
    notFound: { title: "Seite nicht gefunden", sentence: "Die Adresse stimmt nicht, oder die Seite gibt es nicht mehr." },
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
