import "server-only";

import { KONTAKT_EMAIL, VEREIN_ANSCHRIFT, VEREIN_NAME, VEREINSREGISTER, VORSTAND_GEMEINSAM } from "./brand";
import { catalogue, COPY, textOf } from "./copy";
import { formatDatum, formatDatumLong, formatNumber, formatOrdinal, formatSigned } from "./format";

import type { Copy, Words } from "./copy";
import type { CalendarDay } from "./format";
import type { Code } from "./generated/client/types";
import type { ROUTES } from "./routes";

/** The route keys of the pages a search engine may list. */
type ListedRoute = { [Key in keyof typeof ROUTES]: (typeof ROUTES)[Key]["crawl"] extends "index" ? Key : never }[keyof typeof ROUTES];

const { team1, team2 } = COPY.verwaltung.spiel;

// Words two entries of this one object say alike, each written once: a club's place, a group, the goals' difference
// and match operations, the season line's eyebrow and an organiser's role.
const PLATZ = "Platz";
const TEAM = "Team";
const DIFFERENZ = "Diff.";
const SPIELBETRIEB = "Spielbetrieb";
const gruppeName = (gruppe: string) => `Gruppe ${gruppe}`;
const placeName = (platz: number) => `${formatOrdinal(platz)} ${PLATZ}`;

// The confirmation pages' shared sentences, each written once: what the typed birthdate is checked for, the deadline
// of an entry that goes alone, the objection Art. 21 (4) asks to be named explicitly, in the two parts around the
// league's address, and the privacy notice's link, around its title.
const ageCheck = (minAge: number) => `Mit deinem Geburtsdatum prüfen wir, ob du mindestens ${formatNumber(minAge)} Jahre alt bist.`;
const entryDeadline = (until: CalendarDay) => `Bestätigst du nicht bis zum ${formatDatumLong(until)}, löschen wir deinen Eintrag.`;
const OBJECTION_RIGHT = {
  before:
    "Du kannst der Verarbeitung deiner Angaben jederzeit widersprechen, aus Gründen, die sich aus deiner besonderen Situation ergeben (Art. 21 DSGVO). Eine formlose E-Mail an ",
  after: " genügt.",
};
const MORE = { before: "Mehr unter ", after: "." };

/**
 * The bounds the frontend's code holds that the privacy notice's retention table states, passed by its page. An hour
 * read „1 Stunde“ is typed as its one figure, the singular being the sentence's.
 */
type RetentionBounds = {
  bewerbungDays: number;
  schiedsrichterDays: number;
  addressChangeLinkHours: number;
  code: { minutes: number; mailHours: 1; failureHours: number };
  person: { idleDays: number; days: number };
  admin: { idleHours: 1; hours: number };
};

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
    state_ergebnis_on_a_non_event: COPY.shared.field.without(COPY.shared.tore),
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
    /** The league's last owner, whose erasure would leave the administration owned by nobody. */
    last_owner_erasure: "Du bist die letzte Inhaberin oder der letzte Inhaber der Verwaltung.",
    /** A person's own address change to the address they already sign in with. */
    address_change_unchanged: COPY.konto.address.unchanged,
    /** A grant's move nobody but the person could approve. */
    address_change_no_approver: COPY.konto.address.noApprover,
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
    /**
     * A fixture of either club the group swap would trade has taken place, as
     * `fl_backend/app/api/teams/services.py :: has_taken_place` judges it: a result, a recorded no-show or
     * abandonment, or one side's goals.
     */
    swapSidesTakenPlace: "Ein Spiel der beiden Teams hat schon stattgefunden.",
    /** A fixture of the club a replacement takes out of the season has taken place, judged as the swap's. */
    replacementSidesTakenPlace: "Ein Spiel des ausscheidenden Teams hat schon stattgefunden.",
  },

  /**
   * The mail shell's own lines, and the words of the account's mails; every other mail's sentences are its template's
   * until its area's session rewrites them.
   */
  mail: {
    /** The one greeting: the first name where it is known. */
    greeting: (vorname: string) => (vorname === "" ? "Hallo," : `Hallo ${vorname},`),
    /** Under the button, above its link printed to copy. */
    buttonLink: "Falls der Knopf nicht geht, öffne diesen Link:",
    /**
     * The Art. 21 DSGVO objection, set apart from the rest as Art. 21 (4) asks, in the two parts around the league's
     * address, which the shell sets as a link between them.
     */
    // The confirmation pages' words, the shell setting the address between the parts without their spaces.
    objection: { before: OBJECTION_RIGHT.before.trimEnd(), after: OBJECTION_RIGHT.after.trimStart() },
    /** The mail's last line, by its kind: what a reader the mail was not meant for does. */
    notYou: {
      signIn: "Du hast keinen Code angefordert? Dann ignoriere diese E-Mail.",
      security: "Warst du das nicht? Dann antworte sofort auf diese E-Mail.",
      firstContact: "Du weißt nichts davon? Dann antworte auf diese E-Mail, und wir löschen deine Angaben.",
    },

    /** A mailed link's deadline, by the hours its lifetime counts. */
    linkValidFor: (hours: number) => `Der Link gilt ${formatNumber(hours)} Stunden.`,

    /** The sign-in code: no button, since a link carrying the code would sign in whoever opened a forwarded mail. */
    signInCode: {
      subject: "Dein Anmeldecode",
      lead: "Mit diesem Code meldest du dich an:",
      validity: (minutes: number) => `Er gilt ${formatNumber(minutes)} Minuten und nur einmal.`,
      /** The host the code is typed on, in the two parts around it, which the shell sets semibold between them. */
      onlyHere: { before: "Gib ihn nur auf", after: "ein." },
    },

    /** A passkey set up or deleted, in the two parts around the moment, which the shell sets semibold between them. */
    passkeyAdded: {
      subject: "Passkey eingerichtet",
      lead: { before: "Am", after: "wurde in deinem Konto ein Passkey eingerichtet." },
    },
    passkeyRemoved: {
      subject: "Passkey gelöscht",
      lead: { before: "Am", after: "wurde in deinem Konto ein Passkey gelöscht." },
      devices: "Geräte, die damit angemeldet waren, sind abgemeldet.",
    },

    /** The deletion link: the subject and the button are the act's own words, `COPY.page.accountErasure`. */
    erasureLink: {
      lead: "Du hast angefordert, dein Konto zu löschen.",
      // What outlives an erasure is the privacy notice's to list; the one sentence a consequence holds points there.
      consequence: `Dein Konto und alle Angaben unter deiner E-Mail-Adresse werden endgültig gelöscht, bis auf das, was unter „${COPY.page.privacyNotice}“ steht.`,
    },

    /** The person's own address change: the address on file's request, then the new address's. */
    addressChange: {
      /** The address on file's request opens on the page's question; the subject is the page's title. */
      previousEffect: "Sie gilt, sobald beide Adressen sie bestätigt haben.",
    },
  },

  /**
   * The two pages a mail opens for the account, `/confirm/address` and `/erasure`, in the states of
   * `fl_frontend/src/kit/MailedPage.tsx`. The address change's two mails open on these pages' questions.
   */
  addressChange: {
    /** The noun of the address on file's act, „Änderung bestätigen“: Konto's word for the pending change. */
    change: COPY.konto.address.change,
    /** The address on file's question names the address the change goes to under Konto's label for it. */
    newAddress: COPY.konto.address.new,
    previous: {
      question: "Für dein Konto soll eine neue E-Mail-Adresse gelten.",
      confirmed: "Änderung bestätigt",
      confirmedSentence: "Die neue Adresse bekommt jetzt ihren Link.",
    },
    new: {
      question: `Diese Adresse soll künftig für ein Konto bei der ${COPY.brand.name} gelten.`,
      confirmed: "Adresse bestätigt",
      confirmedSentence: "Mit dieser Adresse meldest du dich ab jetzt an.",
      /** A grant holder's confirmed change, which waits on another administrator's approval of the grant's move. */
      awaitsApproval: "Die Änderung gilt, sobald die Verwaltung sie genehmigt hat.",
    },
    declined: "Änderung abgelehnt",
    declinedSentence: "Diese Adresse wird nicht übernommen.",
  },
  accountErasure: {
    /** Under the list of what goes, each row a record the read found. */
    question: "Alles oben wird endgültig gelöscht.",
    /** The list's rows beside each record's own: the account's passkeys, under their box's title, its live address changes, its grant. */
    passkeys: COPY.konto.passkeys.title,
    addressChanges: "Laufende Adressänderungen",
    grant: "Zugang",
    done: "Konto gelöscht",
    doneSentence: `Dein Konto und deine Angaben sind gelöscht, bis auf das, was unter „${COPY.page.privacyNotice}“ steht.`,
    signedOut: "Du bist nicht angemeldet.",
  },

  /**
   * The landing's sections, the blocks About, Kontakt and the sponsors page share with it, and the classic frame's
   * not-found page, each read by a Server Component.
   */
  landing: {
    /** The hero's one heading. */
    tagline: "Frankfurts Abi-Jahrgänge spielen um den Titel",
    /** The one paragraph the league describes itself with, under the tagline and at the head of About. */
    paragraph: `${COPY.brand.description} Ehrenamtliche aus den Jahrgängen organisieren die Liga.`,
    /** The way to apply while a window is open: the hero's second act, the steps' band and the school's door. */
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
      spielorte: { title: COPY.page.verwaltungSpielorte, text: "Kein zentraler Platz. Wo und wann ein Spiel stattfindet, steht im Spielplan." },
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
      /** The band while no window is open; an open window's deadline is the season card's `windowUntil`. */
      closed: "Das Bewerbungsfenster ist geschlossen.",
      /** The school's door while a window is open, where the band and the season card carry its date. */
      opened: "Das Bewerbungsfenster ist offen.",
    },

    /**
     * How a season runs: the numbered dotted line, worded so it holds for any number of groups and rounds. Each
     * point's text; its title is the name the season pages give the phase or the match.
     */
    season: {
      eyebrow: SPIELBETRIEB,
      title: "So läuft eine Saison",
      gruppenphase: "Die Teams spielen in Gruppen jeder gegen jeden.",
      kORunde: "Wer verliert, scheidet aus. Bei Gleichstand entscheidet das Elfmeterschießen.",
      platz3: "Die beiden Verlierer der Halbfinale spielen um Platz 3.",
      finale: "Das Spiel um den Titel.",
    },

    /** The season in four counts. */
    figures: {
      title: (saison: string) => `Saison ${saison} in Zahlen`,
      schulen: "Schulen",
      tore: COPY.shared.tore,
      spiele: COPY.page.spiele,
      spieltage: COPY.spielplan.spieltage,
    },

    organisers: {
      eyebrow: "Organisation",
      title: "Wer dahintersteht",
      /** What each organiser does, under their first name. */
      role: { vorstand: "Vorstand", spielbetrieb: SPIELBETRIEB, website: "Website", kommunikation: "Kommunikation" },
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
      opening: (when: Copy) => `Anpfiff ${when}`,
      /** The opening match's matchday, before its two plaques. */
      spieltag: COPY.shared.spieltag,
      /** An open window's deadline, on the season card and the steps' band alike. */
      windowUntil: (until: CalendarDay) => `Bewerbungen bis ${formatDatum(until)}`,
      last: "Zuletzt",
      next: "Als Nächstes",
      place: placeName,
      /** A place left vacant, its club having left the season before it was decided, beside the dashed open plaque. */
      vacant: "Nicht vergeben",
      /** The chip in the card's head, one word for where the season stands: before its start, running, decided. */
      state: { planned: "Geplant", running: "Läuft", decided: "Entschieden" },
    },

    /** The league's mail address by its label: Kontakt's row, and the doors' and the sponsors page's link. */
    contact: {
      email: "E-Mail",
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
    gruppe: gruppeName,
    /** The match between the two semi-finals' losers: its label, its card's row above the Finale, the pop-up's head. */
    thirdPlace: "Spiel um Platz 3",
    /** A match's own label before its date, on the one line every form of its row shows. */
    labelled: (label: Words, when: Words) => `${textOf(label)} · ${textOf(when)}`,
    /**
     * Where a club stands, under its name in a match head, linking to its row on the Tabelle; a club that has
     * played no match holds no place yet, and the line names its group alone.
     */
    standing: (platz: number | null, gruppe: string) => (platz === null ? gruppeName(gruppe) : `${placeName(platz)} · ${gruppeName(gruppe)}`),

    /** The Tabelle's and the club page's column heads: the short forms on every width. */
    column: {
      platz: PLATZ,
      team: TEAM,
      spiele: "Sp.",
      siege: "S",
      unentschieden: "U",
      niederlagen: "N",
      /** A phone's one column for the three counts, its figures in green, yellow and red. */
      record: "S-U-N",
      tore: COPY.shared.tore,
      differenz: DIFFERENZ,
      punkte: "Pkt.",
      name: COPY.shared.name,
      nummer: "Nr.",
      position: "Position",
    },

    /** The Spielsuche's three filters and Teams' one, each opening on every match or club. */
    filter: { phase: "Phase", team: TEAM, spieltag: COPY.spielplan.fact.spieltag, gruppe: "Gruppe", all: "Alle" },

    /** A club's page: its tiles, its matches and its squad. */
    club: {
      platz: PLATZ,
      punkte: "Punkte",
      spiele: COPY.page.spiele,
      tore: COPY.shared.tore,
      /** Under the goals: their difference, signed. */
      differenz: (difference: number) => `${DIFFERENZ} ${formatSigned(difference)}`,
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
      event: (what: Copy, who: Words) => `${what} · ${textOf(who)}`,
    },
  },

  /**
   * The two legal pages' text, which their pages set as the kit's `Prose` blocks under their titles; the copy
   * standard's legal section governs it. A bound the frontend's code holds is a parameter, so the text states the one
   * the code keeps; a provider's period, and a bound only the backend or a later build holds, is written out. A
   * paragraph with a link stands in parts around it, `before` and `after`, which the page sets the link between.
   */
  legal: {
    privacyNotice: {
      firstLayer: {
        heading: "Das Wichtigste",
        items: [
          `Verantwortlich ist der ${VEREIN_NAME}, ${VEREIN_ANSCHRIFT}.`,
          "Wir verarbeiten, was du uns für eine Bewerbung, einen Kader, ein Spiel oder deine Anmeldung angibst, und die technischen Daten jedes Aufrufs.",
          "Wir brauchen diese Daten, um den Spielbetrieb der Liga durchzuführen, dich zu erreichen und die Website sicher zu betreiben.",
          "Öffentlich sind Teams, Spielpläne, Ergebnisse und Aufstellungen; deinen Namen zeigen wir dort nur mit deiner Einwilligung.",
          "Wir messen nicht, was du auf der Website tust, und verkaufen keine Daten.",
          "Du kannst Auskunft, Berichtigung, Löschung, Einschränkung und die Herausgabe deiner Daten verlangen, widersprechen, jede Einwilligung widerrufen und dich bei der Aufsichtsbehörde beschweren.",
        ],
        /** The last item, around the league's address. */
        contact: { before: "Dafür genügt eine formlose E-Mail an ", after: "." },
      },
      basis: {
        heading: "Rechtsgrundlagen",
        text: "Wo nichts anderes steht, verarbeiten wir deine Daten auf Grundlage von Art. 6 Abs. 1 lit. f DSGVO; unser berechtigtes Interesse ist, den Spielbetrieb der Liga durchzuführen, dich zu erreichen, Fehler in den Daten zu erkennen und die Website vor Angriffen und Missbrauch zu schützen. Wo du eine Einwilligung gibst, ist sie die Grundlage (Art. 6 Abs. 1 lit. a DSGVO). Die Namen des Vorstands im Impressum nennen wir, weil das Gesetz es verlangt (§ 5 DDG, Art. 6 Abs. 1 lit. c DSGVO).",
      },
      website: {
        heading: "Website und Browser",
        requests:
          "Jede Anfrage an die Website läuft zuerst über Cloudflare, Inc.; Cloudflare sieht dabei deine IP-Adresse, die aufgerufene Adresse, die Angaben deines Browsers und jedes Formular, das du abschickst. Bei jedem Aufruf speichert unser Server deine IP-Adresse, den Zeitpunkt, die aufgerufene Seite, den Statuscode und die Kennung deines Browsers.",
        // The passkey cookie's 5 minutes are Better Auth's own, which the library sets and exports no name for.
        browser:
          "In deinem Browser legt die Website nur ab, was ihr Betrieb braucht: ein Sitzungs-Cookie, sobald du dich anmeldest, ein Cookie für die Anmeldung mit einem Passkey, das 5 Minuten gilt, und im lokalen Speicher die Darstellung, hell oder dunkel, die du wählst. Auf der Anmeldeseite, im Bewerbungsformular und im Registrierungsformular prüft Cloudflare Turnstile, ob ein Mensch das Formular abschickt, und fragt dafür Merkmale deines Browsers und deiner Verbindung ab; Cloudflare nutzt sie auch in eigener Verantwortung, um seine Erkennung automatisierter Zugriffe zu verbessern. Beides ist nach § 25 Abs. 2 Nr. 2 TDDDG ohne Einwilligung zulässig.",
      },
      bewerbung: {
        heading: "Bewerbung einer Schule",
        form: (kontakte: number) =>
          `Das Bewerbungsformular fragt Angaben zur Schule und zu ihrem Team, darunter ein dreistelliges Kürzel und die Anschrift der Schule, und ${formatNumber(kontakte)} Kontaktpersonen mit Name, E-Mail-Adresse und Telefonnummer; freiwillig sind nur die Website der Schule, der Trikotsatz und der Wunschgegner. Die Angaben zu den Kontaktpersonen erhalten wir von der Person, die die Bewerbung einreicht.`,
        confirmation: (days: number, trainerAge: number, otherAge: number) =>
          `Jede Kontaktperson bekommt einen eigenen Link, über den sie ihren Eintrag innerhalb von ${formatNumber(days)} Tagen mit ihrem Geburtsdatum bestätigt oder ihm widerspricht, ebenso wenn die Liga sie selbst einträgt; das Mindestalter ist ${formatNumber(trainerAge)} Jahre als Trainer und sonst ${formatNumber(otherAge)}. Haben nach ${formatNumber(days)} Tagen nicht alle bestätigt, löschen wir die Bewerbung und schreiben das der Person, die sie eingereicht hat.`,
      },
      kader: {
        heading: "Im Kader",
        // Session 8: the link's 14 days become a parameter read from `REGISTRIERUNG_BESTAETIGUNG_FRIST_TAGE` once that
        // constant holds the 14 days every link confirming a registered person lives.
        text: (minAge: number) =>
          `In den Kader eines Teams registrierst du dich über dessen Link mit Name und E-Mail-Adresse, wenn du willst auch mit Rückennummer, Position und Stufe, und bestätigst innerhalb von 14 Tagen über einen Link mit deinem Geburtsdatum, dass du mindestens ${formatNumber(minAge)} Jahre alt bist. Über die Aufnahme entscheiden die Kontaktpersonen des Teams; deine E-Mail-Adresse, dein Geburtsdatum und deine Antworten sehen sie nicht.`,
      },
      schiedsrichter: {
        heading: "Schiedsrichterinnen und Schiedsrichter",
        // The referee's minimum age is the backend's alone, `fl_backend/app/shared/schemas/bounds.py`.
        text: (days: number) =>
          `Pfeifst du für die Liga, trägt sie dich mit Name, Kontaktdaten, Schule und Honorar ein, so wie du oder die Person, die dich genannt hat, sie uns mitteilt. Über einen Link bestätigst du den Eintrag innerhalb von ${formatNumber(days)} Tagen mit deinem Geburtsdatum; pfeifen kann, wer mindestens 16 Jahre alt ist. Löschen wir deinen Eintrag, bleibt an angesetzten und gespielten Spielen das Honorar ohne deinen Namen stehen.`,
      },
      spiele: {
        heading: "Spiele und Spielberichte",
        text: "Vor einem Spiel fragen wir beide Teams und die Schiedsrichterin oder den Schiedsrichter, ob der Termin steht; eine Absage kann eine Begründung als freien Text tragen. Nach dem Spiel trägt die Schiedsrichterin oder der Schiedsrichter einen Spielbericht ein: Ergebnis, Tore und Karten mit Minute und Person, zu einer Karte einen Grund aus einer festen Liste und Bemerkungen als freien Text.",
      },
      account: {
        heading: "Anmeldung und Konto",
        // An administrator's idle hour is typed as its one figure: a sentence reading „nach 1 Stunde“ is singular.
        signIn: (code: { minutes: number }, person: { idleDays: number; days: number }, admin: { idleHours: 1; hours: number }) =>
          `Du meldest dich mit einem Code an, den wir dir schicken und nach ${formatNumber(code.minutes)} Minuten löschen, oder mit einem Passkey, zu dem wir seinen öffentlichen Schlüssel mit Kennung und Zähler, den Anbieter, bei dem er liegt, ob er gesichert ist, wie dein Gerät ihn erreicht, seinen Namen und seine letzte Nutzung speichern, nie seinen privaten Schlüssel; mit Zugang zur Verwaltung nur mit einem Passkey. Eine Sitzung endet nach ${formatNumber(person.idleDays)} Tagen ohne Nutzung, spätestens nach ${formatNumber(person.days)} Tagen; mit Zugang zur Verwaltung nach ${formatNumber(admin.idleHours)} Stunde ohne Nutzung, spätestens nach ${formatNumber(admin.hours)} Stunden.`,
        // Session 7: the grant's 24-hour wait becomes a parameter read from the code once that session builds it.
        changes: (linkHours: number, stopDays: number) =>
          `Eine neue E-Mail-Adresse bestätigst du zuerst über einen Link an deine bisherige Adresse und danach über einen Link an die neue, jeder ${formatNumber(linkHours)} Stunden gültig; sie gilt, sobald du beide bestätigt hast. Kommst du an deine bisherige Adresse nicht mehr heran, ändert die Liga sie auf deine Anfrage und vermerkt den Grund; die bisherige Adresse erfährt davon und kann die Änderung ${formatNumber(stopDays)} Tage lang stoppen. Ein Zugang zur Verwaltung gilt erst 24 Stunden, nachdem er vergeben ist, auch für eine neue Adresse; alle mit Zugang erfahren sofort davon, und bis dahin lässt er sich zurücknehmen. Dein Konto löschst du jederzeit selbst, bestätigt über einen Link an deine Adresse; sonst bleibt es, solange unter deiner Adresse ein Eintrag bei uns besteht.`,
      },
      mail: {
        heading: "E-Mail und WhatsApp",
        senders:
          "Unsere E-Mails verschicken wir über Resend, Codes und Sicherheitshinweise von anmeldung@frankfurtleague.de, alle anderen von liga@frankfurtleague.de; Resend meldet uns, ob eine E-Mail ankommt, und wir speichern das bei der Nachricht.",
        forwarding:
          "Ein eigenes Postfach hat die Liga nicht: E-Mails an die Liga leitet Cloudflare an die privaten Postfächer der Personen weiter, die die Liga organisieren, und die Antwort kommt von deren privater Adresse. Den Inhalt speichert Cloudflare nach eigener Angabe nicht, nur Absender, Empfänger und Betreff. Deine Nachricht löschen wir, sobald sie erledigt ist und keine Pflicht zur Aufbewahrung besteht.",
        whatsapp:
          "Über WhatsApp schreiben wir dir nur, wenn du das erlaubt hast oder uns dort schreibst; dann erhält WhatsApp deine Telefonnummer und die Nachrichten.",
      },
      published: {
        heading: "Was wir veröffentlichen",
        record:
          "Auf der Website stehen Name, Kürzel, Schule und Anschrift jedes Teams, Spielpläne, Ergebnisse und Tabellen, Aufstellungen, sobald ein Team sie einträgt, Tore und Karten, sobald der Spielbericht feststeht, und als freier Text Notizen zu Spielen, Beschreibungen von Teams und der Grund für einen Rückzug.",
        names:
          "Stehst du im Kader, zeigen wir dort, in Aufstellungen und bei Toren und Karten deinen Vornamen und den Anfangsbuchstaben deines Nachnamens; pfeifst du, zeigen wir an deinen Spielen den ersten Teil deines Namens und den Anfangsbuchstaben des nächsten, bei nur einem Namen diesen ganz. Beides zeigen wir nur mit deiner Einwilligung, sonst steht dort „anonym“; im Kader stehen Rückennummer und Position in beiden Fällen.",
        consented: (mediaAge: number) =>
          `Ebenfalls nur mit Einwilligung zeigen wir die Vornamen der Personen, die die Liga organisieren, auf der Startseite und unter „${COPY.page.about}“ und, ab ${formatNumber(mediaAge)} Jahren, Fotos, Videos und Interviews, auf denen du zu erkennen bist, hier und auf dem Instagram-Kanal der Liga. Widerrufst du, entfernen wir Fotos, Videos und Interviews von dir von der Website und vom Instagram-Kanal der Liga.`,
        never:
          "Nie veröffentlichen wir Kontaktdaten, Geburtsdaten, Registrierungen, Kontaktpersonen, Antworten zu Einwilligungen, die Stufe, Schule und Honorar einer Schiedsrichterin oder eines Schiedsrichters, Kartengründe und die Bemerkungen eines Spielberichts.",
      },
      recipients: {
        heading: "Empfänger",
        lead: "Außer uns erhalten deine Daten nur:",
        items: [
          "Hetzner Online GmbH, Nürnberg: unser Server;",
          "Cloudflare, Inc.: jede Anfrage, Turnstile und die Weiterleitung von E-Mails;",
          "MongoDB, Inc.: die Datenbank und ihre Sicherungskopien, in Frankfurt am Main;",
          "Resend (Plus Five Five, Inc.): unsere E-Mails;",
          "die Anbieter der privaten Postfächer: E-Mails an die Liga und unsere Antworten, ohne Vertrag zur Auftragsverarbeitung;",
          "WhatsApp Ireland Limited, wenn du WhatsApp erlaubst: die gewöhnliche App, ohne Vertrag zur Auftragsverarbeitung;",
          "Meta (Instagram), selbst verantwortlich: die Fotos, Videos und Interviews, die du erlaubst.",
        ],
        transfers:
          "In die Vereinigten Staaten übermitteln wir auf Grundlage des Angemessenheitsbeschlusses zum EU-US Data Privacy Framework (Art. 45 DSGVO), für Cloudflare und Resend auch der Standardvertragsklauseln der Europäischen Kommission (Art. 46 Abs. 2 lit. c DSGVO), deren Kopie wir dir auf Anfrage schicken. Ein privates Postfach kann in einem Land ohne Angemessenheitsbeschluss liegen; für diese Übermittlung gibt es keine geeigneten Garantien. Darüber hinaus geben wir keine Daten weiter, auch nicht an unsere Sponsoren.",
      },
      /**
       * The retention table: each store's name, what it holds and how long. A bound the frontend's code holds is a
       * parameter; the rest are the rulings' and the providers', several of which only the backend, a host script or a
       * later session's build holds, so each is written out. A confirmation link's days stand for a declined item's
       * too, the rulings giving both one wait.
       */
      retention: {
        heading: "Speicherdauer",
        nameLabel: "Daten",
        content: "Inhalt",
        period: "Dauer",
        rows: [
          {
            name: "Bewerbung",
            content: "Schule, Team, Kontaktpersonen",
            period: (bound: RetentionBounds) =>
              `${formatNumber(bound.bewerbungDays)} Tage, wenn nicht alle bestätigen; abgelehnt ${formatNumber(bound.bewerbungDays)} Tage`,
          },
          {
            name: "Kontaktpersonen",
            content: "Kontaktdaten, Geburtsdatum, Antworten",
            period: (bound: RetentionBounds) =>
              `${formatNumber(bound.bewerbungDays)} Tage, wenn unbestätigt oder abgelehnt; sonst bis zum Ende der Saison danach`,
          },
          // Session 8: the 14 days become `REGISTRIERUNG_BESTAETIGUNG_FRIST_TAGE` once that constant holds them.
          { name: "Registrierung", content: "Name, Adresse, Geburtsdatum", period: "14 Tage, wenn unbestätigt oder abgelehnt" },
          {
            name: "Registrierungslinks",
            content: "Team, Saison, Adresse der Person aus der Verwaltung, die ihn erstellt hat",
            period: "ohne Frist; die Adresse bis zur Löschung dieser Person",
          },
          { name: "Kader und Aufstellungen", content: "Name, Adresse, Geburtsdatum, Antworten", period: "bis zum Ende der Saison danach" },
          {
            name: "Schiedsrichter",
            content: "Name, Kontaktdaten, Honorar, Antworten",
            period: (bound: RetentionBounds) =>
              `${formatNumber(bound.schiedsrichterDays)} Tage, wenn unbestätigt oder abgelehnt; sonst bis du oder die Liga den Eintrag beenden`,
          },
          {
            name: "Teams und Spiele",
            content: "Ergebnisse, Tore, Karten, Notizen",
            period: "als Chronik der Liga; Namen darin nur, solange der Eintrag der Person besteht",
          },
          { name: "Freie Texte zu Spielen", content: "Absagegründe, Kartengründe, Bemerkungen", period: "bis zum Ende der Saison danach" },
          { name: "Gesperrte Adresse", content: "Adresse, Grund, Datum", period: "5 Saisons" },
          { name: "Zugang zur Verwaltung", content: "Adresse, Stufe, Beginn", period: "bis er endet" },
          { name: "Konto", content: "Adresse, Passkeys", period: "solange ein Eintrag besteht" },
          {
            name: "Anmeldung",
            content: "Code; Zahl der Codes und der Fehlversuche je Adresse, pseudonymisiert",
            period: (bound: RetentionBounds) =>
              `Code ${formatNumber(bound.code.minutes)} Minuten; Codes ${formatNumber(bound.code.mailHours)} Stunde, Fehlversuche ${formatNumber(bound.code.failureHours)} Stunden`,
          },
          {
            name: "Sitzungen",
            content: "Beginn, letzte Nutzung, Art der Anmeldung",
            period: (bound: RetentionBounds) =>
              `${formatNumber(bound.person.idleDays)} Tage ohne Nutzung, höchstens ${formatNumber(bound.person.days)}; mit Zugang zur Verwaltung ${formatNumber(bound.admin.idleHours)} Stunde ohne Nutzung, höchstens ${formatNumber(bound.admin.hours)} Stunden`,
          },
          // The ended change's 30 days are the backend's alone, `fl_backend/app/shared/schemas/bounds.py ::
          // ADDRESS_CHANGE_RETENTION_DAYS`.
          {
            name: "Adressänderung",
            content: "Beide Adressen; bei einer Änderung auf Anfrage der Grund",
            period: (bound: RetentionBounds) =>
              `jeder Link ${formatNumber(bound.addressChangeLinkHours)} Stunden; Adressen und Grund bis zu ihrem Ende, der Rest 30 Tage danach`,
          },
          { name: "Änderungsprotokoll", content: "Änderungen", period: "12 Monate" },
          // A host script's, `scripts/ops/export_journal.sh :: JOURNAL_DAYS`, each day's file counted from its last change.
          {
            name: "Löschungen und Widerrufe",
            content: "Art, Zeitpunkt und Datensatz, die Adresse pseudonymisiert, auch zu Adressänderungen und Anträgen auf Zugang",
            period: "30 Tage",
          },
          { name: "Protokolle des Servers", content: "Aufrufe, Anmeldungen, Löschungen", period: "9 Tage" },
          { name: "Unsere E-Mails", content: "Inhalt, Adresse, Zustellstand", period: "Inhalt bis zum Versand, der Rest 30 Tage danach" },
          { name: "E-Mails bei Resend", content: "Adresse, Betreff, Inhalt", period: "30 Tage, in Sicherungen bis 7 Tage länger" },
          { name: "E-Mails bei Cloudflare", content: "Absender, Empfänger, Betreff", period: "31 Tage" },
        ],
      },
      erasure: {
        heading: "Löschung",
        text: "Löschen wir Daten, auf deinen Wunsch oder nach ihrer Frist, verschwinden sie sofort aus der Datenbank und nach etwa 8 Tagen aus den Sicherungskopien; spielen wir eine ältere Sicherung ein, löschen wir sie erneut. Es bleiben die Kopien bei Resend und Cloudflare bis zu ihren Fristen, eine Sperre deiner Adresse bis zu ihrem Ende, die E-Mail mit dem Link zur Löschung, bis er abläuft, freie Texte, die nicht unter deiner Adresse stehen, und im Änderungsprotokoll, was du unter einer früheren Adresse geändert hast. Löschen wir ein bestätigtes Konto oder eine bestätigte Bewerbung, schreiben wir dir das.",
        log: "Jede Änderung an den Daten der Liga halten wir 12 Monate im Änderungsprotokoll fest; eine Person steht darin nur mit Rolle, Team und Nummer ihres Eintrags, eine persönliche Angabe nur als geändert, ohne ihren Inhalt.",
      },
      rights: {
        heading: "Deine Rechte",
        /** Around the league's address. */
        text: {
          before:
            "Du hast das Recht auf Auskunft, Berichtigung, Löschung, Einschränkung der Verarbeitung und Datenübertragbarkeit (Art. 15 bis 18 und 20 DSGVO). Eine Einwilligung widerrufst du jederzeit für die Zukunft, in deinem Konto oder per E-Mail; was bis dahin geschah, bleibt rechtmäßig. Für alles genügt eine formlose E-Mail an ",
          after: ".",
        },
        /** The Art. 21 DSGVO objection, set apart as Art. 21 (4) asks; a callout's text holds no link, so it names the address. */
        objection: {
          title: "Recht auf Widerspruch",
          text: `Jeder Verarbeitung auf Grundlage von Art. 6 Abs. 1 lit. f DSGVO kannst du aus Gründen deiner besonderen Situation widersprechen (Art. 21 DSGVO); eine E-Mail an ${KONTAKT_EMAIL} genügt.`,
        },
        closing:
          "Automatisierte Entscheidungen im Sinne von Art. 22 DSGVO treffen wir nicht. Einen Datenschutzbeauftragten haben wir nicht bestellt. Beschweren kannst du dich bei einer Datenschutzaufsichtsbehörde, für uns beim Hessischen Beauftragten für Datenschutz und Informationsfreiheit, Postfach 3163, 65021 Wiesbaden.",
      },
      /** The notice's last paragraph: the day its words took effect. */
      stand: (day: CalendarDay) => `Stand: ${formatDatumLong(day)}`,
    },

    legalNotice: {
      provider: { heading: "Anbieter", name: VEREIN_NAME, address: VEREIN_ANSCHRIFT },
      representation: {
        heading: "Vertretung",
        rule: `Je ${formatNumber(VORSTAND_GEMEINSAM)} Mitglieder des Vorstands vertreten den Verein gemeinsam:`,
        member: (name: string, amt: string) => `${name}, ${amt}`,
      },
      /** Before the league's address, which the page sets as a link after it. */
      contact: { heading: "Kontakt", lead: "E-Mail: " },
      register: { heading: "Registereintrag", entry: VEREINSREGISTER },
      /** Before the repository's link, which the page sets after it under `link`. */
      licence: { heading: "Lizenz", lead: "Der Quellcode dieser Website steht unter der Elastic License 2.0: ", link: "Quellcode auf GitHub" },
    },
  },

  // Session 6: its page reads these.
  /**
   * The fixed text of a contact person's confirmation page, `ROUTES.kontaktConfirmation`, titled
   * `COPY.page.entryConfirmation`: who named the person and for what, what is stored and until when, what the birthdate
   * is checked for, the deadline, what an objection does, the objection Art. 21 (4) asks to be named explicitly, since the
   * seat rests on legitimate interest, and the privacy notice's link. The consents under it are
   * `fl_frontend/src/core/consentWordings.ts`'s; nobody accepts the notice, which informs and asks no consent.
   */
  kontaktConfirmation: {
    /** The first sentence, by how the seat came to be. */
    opening: {
      /** Named in an application by the person who submitted it. */
      named: (submitter: Words, schule: Words, saison: string, rolle: Words) =>
        `${textOf(submitter)} hat dich in der Bewerbung von ${textOf(schule)} für die ${COPY.shared.saisonName(saison)} als ${textOf(rolle)} genannt.`,
      /** The submitter's own seat. */
      self: (schule: Words, saison: string, rolle: Words) =>
        `Du hast dich in der Bewerbung von ${textOf(schule)} für die ${COPY.shared.saisonName(saison)} als ${textOf(rolle)} eingetragen.`,
      /** Seated in an application by the league. */
      byLeague: (schule: Words, saison: string, rolle: Words) =>
        `Die Liga hat dich in der Bewerbung von ${textOf(schule)} für die ${COPY.shared.saisonName(saison)} als ${textOf(rolle)} eingetragen.`,
      /** Seated by the league on a team's season, with no application. */
      seasonRow: (team: Words, saison: string, rolle: Words) =>
        `Die Liga hat dich für ${textOf(team)} in der ${COPY.shared.saisonName(saison)} als ${textOf(rolle)} eingetragen.`,
    },
    stored: "Wir speichern deinen Namen, deine Kontaktdaten und dein Geburtsdatum längstens bis zum Ende der Saison danach.",
    /** At the birthdate's field, by the seat's floor: Art. 13 asks the purpose where the date is asked. */
    ageCheck,
    /** The deadline of a seat in an application, which goes whole when one seat stays unconfirmed. */
    applicationDeadline: (kontakte: number, until: CalendarDay) =>
      `Bestätigen nicht alle ${formatNumber(kontakte)} Kontaktpersonen bis zum ${formatDatumLong(until)}, löschen wir die Bewerbung.`,
    /** The deadline of a seat on a team's season, which goes alone. */
    seatDeadline: entryDeadline,
    /**
     * At the objection's control, read before the press, by how the seat came to be: an application's seat tells the
     * person who submitted it, unless the seat is that person's own, and a season row's seat tells nobody.
     */
    objectionEffect: {
      application: "Widersprichst du, entfernen wir deine Angaben aus der Bewerbung und schreiben das der Person, die sie eingereicht hat.",
      self: "Widersprichst du, entfernen wir deine Angaben aus der Bewerbung.",
      seasonRow: "Widersprichst du, löschen wir deinen Eintrag.",
    },
    /** The Art. 21 (4) sentence, its own paragraph, around the league's address, which the page sets as a link. */
    objectionRight: OBJECTION_RIGHT,
    /** The last line, around the privacy notice's title, which the page sets as its link. */
    more: MORE,
  },

  // Session 5: its page reads these.
  /**
   * The fixed text of a referee's confirmation page, `ROUTES.schiedsrichterConfirmation`, built as
   * `kontaktConfirmation` is: who entered the person and for what, what is stored and until when, the deadline, what
   * the birthdate is checked for, the objection and the privacy notice's link. The referee's floor is the backend's
   * alone, so the page passes the one its read serves.
   */
  schiedsrichterConfirmation: {
    opening: "Die Liga hat dich als Schiedsrichterin oder Schiedsrichter für ihre Spiele eingetragen.",
    stored:
      "Wir speichern deinen Namen, deine Kontaktdaten, dein Honorar, dein Geburtsdatum und deine Schule, wenn sie angegeben ist, bis du oder die Liga den Eintrag beenden.",
    ageCheck,
    deadline: entryDeadline,
    objectionRight: OBJECTION_RIGHT,
    more: MORE,
  },

  // Session 8: its page reads these.
  /**
   * The fixed text of a pupil's confirmation page, `ROUTES.registrierungConfirmation`, built as `kontaktConfirmation`
   * is: the registration the pupil made, what is stored and until when, the deadline, what the birthdate is checked
   * for, the objection and the privacy notice's link.
   */
  registrierungConfirmation: {
    opening: (team: Words, saison: string) =>
      `Du hast dich über den Link von ${textOf(team)} für den Kader in der ${COPY.shared.saisonName(saison)} registriert.`,
    stored:
      "Wir speichern deinen Namen, deine E-Mail-Adresse, dein Geburtsdatum und, wenn du sie angegeben hast, Rückennummer, Position und Stufe, längstens bis zum Ende der Saison danach.",
    ageCheck,
    deadline: (until: CalendarDay) => `Bestätigst du nicht bis zum ${formatDatumLong(until)}, löschen wir deine Registrierung.`,
    objectionRight: OBJECTION_RIGHT,
    more: MORE,
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
    spiel: (team1: Words, team2: Words, saison: string) =>
      `${textOf(team1)} gegen ${textOf(team2)} in der Saison ${saison} der Frankfurt League: Termin, Ort, Ergebnis und Aufstellungen.`,
    contact: "Die Frankfurt League erreichst du per E-Mail, auf Instagram und auf Threads.",
    sponsors: "Die Sponsoren der Frankfurt League, und wie du die Liga unterstützen kannst.",
    legalNotice: "Anbieterkennzeichnung der Frankfurt League nach § 5 DDG.",
    privacyNotice: "Welche Daten die Frankfurt League verarbeitet, auf welcher Grundlage und wie lange.",
  } satisfies Record<ListedRoute, string | ((...names: never) => string)>,
});
