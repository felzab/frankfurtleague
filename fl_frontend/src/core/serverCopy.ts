import "server-only";

import { KONTAKT_EMAIL } from "./brand";
import { catalogue, COPY } from "./copy";
import { formatDatum, formatNumber } from "./format";

import type { CalendarDay } from "./format";
import type { Code } from "./generated/client/types";
import type { ROUTES } from "./routes";

/** The route keys of the pages a search engine may list. */
type ListedRoute = { [Key in keyof typeof ROUTES]: (typeof ROUTES)[Key]["crawl"] extends "index" ? Key : never }[keyof typeof ROUTES];

const { team1, team2 } = COPY.verwaltung.spiel;

/**
 * The catalogue's entries only the server reads, so no client bundle carries them: `COPY` is one object, and a
 * bundler keeps all of an object a client module imports. Branded as `COPY` is, so an entry passes wherever a `Copy`
 * is asked for.
 */
export const SERVER_COPY = catalogue({
  /**
   * A refusal's phrase under the field it is about, by the backend's code, for a code a person causes knowingly from
   * a screen: one of `COPY.shared.field`'s patterns, and nothing else. A code no pattern words takes `refusalLine`'s
   * sentence instead; every other code answers one of the shared failure lines `COPY.shared.failure` holds.
   */
  refusal: {
    duplicate_key: COPY.shared.field.taken,
    // One rule over two codes: a match whose result no play decides carries no goals, on the fixture and in its report.
    state_ergebnis_on_a_non_event: COPY.shared.field.without(COPY.verwaltung.spiel.tore),
  } satisfies Partial<Record<Code, string>>,

  /**
   * A refusal's sentence on the status line, by the backend's code, for a code a person causes knowingly from a
   * screen that no field pattern words: the write as a whole, or a field the sentence names itself. Where one code
   * is about one of several fields, its sentence is keyed by the first name of the path the backend names, so it
   * says which; a path it holds no sentence for is not this screen's to word.
   */
  refusalLine: {
    saison_past: "Diese Saison ist abgeschlossen.",
    spiel_outside_spieltag: "Dieses Datum liegt außerhalb des Spieltags.",
    state_nichtantreten_without_two_sides: "Beide Teams stehen noch nicht fest.",
    booking_unknown_resource: {
      ort: "Der Spielort ist stillgelegt oder gelöscht.",
      schiedsrichter: "Der Schiedsrichter ist stillgelegt oder gelöscht.",
    },
    booking_unconfirmed_schiedsrichter: "Der Schiedsrichter hat den eigenen Eintrag noch nicht bestätigt.",
    spiel_double_booked: {
      ort: "Der Spielort ist zu dieser Zeit schon belegt.",
      schiedsrichter: "Der Schiedsrichter ist zu dieser Zeit schon eingeteilt.",
    },
    eligibility_disqualified: {
      team1: `${team1} ist aus der Saison ausgeschieden.`,
      team2: `${team2} ist aus der Saison ausgeschieden.`,
    },
  } satisfies Partial<Record<Code, string | Readonly<Record<string, string>>>>,

  /**
   * A rule's sentence on the status line, by the kind the backend refuses a payload with (`fields[].kind`), for a
   * rule a person can break that no field pattern words: placed as `refusalLine` places a code. Every rule a pattern
   * words is worded by `fl_frontend/src/core/ruleMessage.ts :: ruleMessage`.
   */
  ruleLine: {
    elfmeterschiessen_without_winner: "Das Elfmeterschießen hat keinen Sieger.",
    elfmeterschiessen_without_draw: "Das Ergebnis ist kein Unentschieden.",
    torschuetzen_not_matching_tore: "Die Torschützen passen nicht zum Ergebnis.",
  },

  /** The image a shared link's preview shows, by its alt, which a screen reader reads in the preview's place. */
  shareImage: {
    alt: `${COPY.brand.name}, die Fußballliga der Frankfurter Oberstufen: der Pokal über dem Schriftzug`,
  },

  /** The administration's lines its old pages answer through their server actions, until each page's rebuild. */
  verwaltung: {
    /** A result entered early on a fixture of either club the group swap would trade. */
    swapSidesTakenPlace: "Ein Spiel der beiden Teams hat schon ein Ergebnis.",
    /** A result entered early on a fixture of the club a replacement takes out of the season. */
    replacementSidesTakenPlace: "Ein Spiel des ausscheidenden Teams hat schon ein Ergebnis.",
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
      /** The school's door while a window is open, where the band and the season card carry its date. */
      opened: "Das Bewerbungsfenster ist offen.",
    },

    /**
     * How a season runs: the numbered dotted line, worded so it holds for any number of groups and rounds. Each
     * point's text; its title is the name the season pages give the phase or the match.
     */
    season: {
      eyebrow: "Spielbetrieb",
      title: "So läuft eine Saison",
      gruppenphase:
        "Die Teams spielen in Gruppen jeder gegen jeden. Nur diese Spiele zählen für die Tabelle, und die Besten jeder Gruppe kommen weiter.",
      kORunde: "Wer verliert, scheidet aus. Bei Gleichstand entscheidet das Elfmeterschießen.",
      platz3: "Die beiden Verlierer der Halbfinale spielen um Platz 3.",
      finale: "Das Spiel um den Titel.",
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
      /** The opening match's Anpfiff, when it is set to start. */
      opening: (when: string) => `Anpfiff ${when}`,
      /** The opening match's matchday, before its two plaques. */
      spieltag: COPY.shared.spieltag,
      windowUntil: (until: CalendarDay) => `Bewerbungen bis ${formatDatum(until)}`,
      last: "Zuletzt",
      next: "Als Nächstes",
      place: (platz: number) => `${formatNumber(platz)}. Platz`,
      /** A place left vacant, its club having left the season before it was decided, beside the dashed open plaque (D499). */
      vacant: "Nicht vergeben",
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

  /**
   * The public season pages and the kit's season blocks, drawn on the server alone. Every entry is a draft for
   * the season board.
   */
  season: {
    /** One group's card on the Tabelle, and a club's group on Teams and its page. */
    gruppe: (gruppe: string) => `Gruppe ${gruppe}`,
    /** The match between the two semi-finals' losers: its label, its card's row above the Finale, the pop-up's head. */
    thirdPlace: "Spiel um Platz 3",
    /** A group matchday, as a match's head names it. */
    spieltag: COPY.shared.spieltag,
    /** A match's own label before its date, on the one line every form of its row shows. */
    labelled: (label: string, when: string) => `${label} · ${when}`,
    /**
     * Where a club stands, under its name in a match head, linking to its row on the Tabelle; a club that has
     * played no match holds no place yet, and the line names its group alone.
     */
    standing: (platz: number | null, gruppe: string) =>
      platz === null ? `Gruppe ${gruppe}` : `${formatNumber(platz)}. Platz · Gruppe ${gruppe}`,
    /** `/saisons` while the league has no season yet, under the strip's title. */
    noSaison: "Die erste Saison ist noch nicht angelegt.",

    /** The Tabelle's and the club page's column heads: the short forms on every width. */
    column: {
      platz: "Platz",
      team: "Team",
      spiele: "Sp.",
      siege: "S",
      unentschieden: "U",
      niederlagen: "N",
      /** A phone's one column for the three counts, its figures in green, yellow and red. */
      record: "S-U-N",
      tore: "Tore",
      differenz: "Diff.",
      punkte: "Pkt.",
      gruppe: "Gruppe",
      name: "Name",
      nummer: "Nr.",
      position: "Position",
    },

    /** The Spielsuche's three filters, each opening on every match. */
    filter: { phase: "Phase", team: "Team", spieltag: "Spieltag", all: "Alle" },

    /** A club's page: its tiles, its matches and its squad. */
    club: {
      platz: "Platz",
      punkte: "Punkte",
      spiele: "Spiele",
      tore: "Tore",
      /** Under the goals: their difference, signed. */
      differenz: (difference: string) => `Diff. ${difference}`,
    },

    /** A match's page: its line-ups, and its goals and cards by minute. */
    spiel: {
      aufstellung: "Aufstellung",
      toreUndKarten: "Tore und Karten",
      /**
       * The plural the match's empty timeline names until its report is adopted, whose goals and cards are not
       * official before: „Noch keine offiziellen Tore und Karten.“, where an adopted report naming none reads
       * „Noch keine Tore und Karten.“
       */
      officialToreUndKarten: "offiziellen Tore und Karten",
      /** A pupil whose consent publishes no name, or one erased since. */
      anonym: "anonym",
      /** A goal nobody was named for. */
      unbekannt: "unbekannt",
      tor: "Tor",
      eigentor: "Eigentor",
      karte: { gelb: "Gelbe Karte", gelb_rot: "Gelb-Rote Karte", rot: "Rote Karte" },
      /** A checkpoint's title: what happened, and to whom. */
      event: (what: string, who: string) => `${what} · ${who}`,
    },
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
    spiel: (heim: string, gast: string, saison: string) =>
      `${heim} gegen ${gast} in der Saison ${saison} der Frankfurt League: Termin, Ort, Ergebnis und Aufstellungen.`,
    contact: "Die Frankfurt League erreichst du per E-Mail, auf Instagram und auf Threads.",
    sponsors: "Die Sponsoren der Frankfurt League, und wie du die Liga unterstützen kannst.",
    legalNotice: "Anbieterkennzeichnung der Frankfurt League nach § 5 DDG und § 18 Abs. 2 MStV.",
    privacyNotice: "Welche Daten die Frankfurt League verarbeitet, auf welcher Grundlage und wie lange.",
  } satisfies Record<ListedRoute, string | ((...names: never) => string)>,
});
