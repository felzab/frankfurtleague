import "server-only";

import { BRAND_NAME, mailOrigin } from "./emailShell";
import { DEIN_BEREICH_TITEL, EINSAETZE_TITEL } from "./seitenNamen";

import type { Fakt, Lauf, Mail } from "./emailShell";

/**
 * One fixture as a message states it, every value rendered by the caller:
 * `fl_frontend/src/shared/utils/format.ts :: formatSpielDatum` and `:: formatUhrzeit` sit in a layer
 * `core` may not reach. No person, the referee included.
 */
export interface SpielAnsetzungText {
  /** The two sides in the fixture's own order, as the schedule lists them. */
  readonly team1: string;
  readonly team2: string;
  readonly datumText: string;
  readonly uhrzeitText: string;
  readonly ortText: string;
}

/**
 * What one mailbox of a team is asked. No name and no seat: the administrator typed this address, so
 * behind a typo its reader is a stranger, owed none.
 */
export interface SpielAnfrageData {
  /** The serving origin, never `fl_frontend/src/core/brand.ts :: SITE_URL`. */
  readonly origin: string;
  /** The finished absolute URL. The token inside it is a bearer credential and is never taken apart here. */
  readonly link: string;
  /** The reader's own club, one of the two sides. */
  readonly team: string;
  readonly ansetzung: SpielAnsetzungText;
  /** The deadline the sweep answered, as a German date: a reminder repeats it, and nothing here reckons one. */
  readonly fristText: string;
}

/** What a referee booked onto a fixture is told. No token: the answer is given on their own panel, signed in. */
export interface SpielEinteilungData {
  readonly origin: string;
  readonly ansetzung: SpielAnsetzungText;
}

/** Who a moved fixture's notice goes to: a team's mailbox was asked, a referee was booked. */
type SpielEmpfaenger = "team" | "schiedsrichter";

/** What a party asked about a fixture since moved is told: the slot it was asked about, which is the one it knows. */
export interface SpielNeueAnsetzungData {
  readonly origin: string;
  readonly team1: string;
  readonly team2: string;
  readonly altDatumText: string;
  readonly altUhrzeitText: string;
  readonly empfaenger: SpielEmpfaenger;
}

/** What a party asked about a fixture called off since is told: the slot it was asked about, the one it knows. */
export type SpielAbgesagtData = SpielNeueAnsetzungData;

/** What a referee taken off a fixture after their Einteilung went out is told: the slot they were told of, as they know it. */
export interface SpielEinteilungAufgehobenData {
  readonly origin: string;
  readonly team1: string;
  readonly team2: string;
  readonly altDatumText: string;
  readonly altUhrzeitText: string;
}

/** The referee's own panel, the address `fl_frontend/src/features/funktionen/utils.ts` opens their Funktion on. */
const SCHIEDSRICHTER_PANEL_PATH = "/bereich/schiedsrichter";

/** The pairing as the copy rules spell one: the two clubs by name, joined by „gegen“. */
function paarung(team1: string, team2: string): readonly Lauf[] {
  return [{ stark: team1 }, " gegen ", { stark: team2 }];
}

/** The slot, one fact to a row, so a reader scanning for the day finds it alone. */
function termin({ datumText, uhrzeitText, ortText }: SpielAnsetzungText): readonly Fakt[] {
  return [
    { label: "Termin", wert: `${datumText}, ${uhrzeitText} Uhr` },
    { label: "Ort", wert: ortText },
  ];
}

/** An earlier slot inside a sentence, in the emphasis grade. */
const alterTermin = (datum: string, uhrzeit: string): Lauf => ({ stark: `${datum} um ${uhrzeit} Uhr` });

type AnfrageArt = "anfrage" | "erinnerung";

function buildAnfrage(art: AnfrageArt, { origin, link, team, ansetzung, fristText }: SpielAnfrageData): Mail {
  const spiel = `${ansetzung.team1} gegen ${ansetzung.team2} am ${ansetzung.datumText}`;

  return {
    art: "mitteilung",
    betreff: art === "anfrage" ? `Bitte bestätigen: ${spiel}` : `Erinnerung: ${spiel} bestätigen`,
    // Through `mailOrigin` once, for the footer: the link is spelled by its own module and arrives
    // finished, so a second derivation here could send the two versions to different hosts.
    origin: mailOrigin(origin),
    vorname: "",
    absaetze: [
      [
        // The first request says the fixture is set, the reminder that the team's answer is still owed.
        art === "anfrage"
          ? ["Die Verwaltung der ", BRAND_NAME, " hat das Spiel ", ...paarung(ansetzung.team1, ansetzung.team2), " angesetzt."]
          : ["Für das Spiel ", ...paarung(ansetzung.team1, ansetzung.team2), " steht die Antwort Deines Teams noch aus."],
        // Both answers named before the press, as the page offers both: a reader expecting one button meets two.
        [{ stark: `Bitte bestätige den Termin für ${team} oder schlag einen anderen vor.` }],
      ],
    ],
    block: { fakten: termin(ansetzung) },
    // The deadline, the first-press rule and what silence costs. Any of the team's seats answers, the first
    // press binding, so a reader told nothing of it takes a colleague's answer for a dead link.
    nachBlock: [
      [
        ["Bitte antworte bis zum ", { stark: fristText }, "."],
        "Es gilt die erste Antwort aus Deinem Team, danach funktioniert der Link nicht mehr.",
        "Kommt bis dahin keine Antwort, legt die Verwaltung der Liga den Termin fest.",
        // A reminder carries a fresh link, and the first request's still answers beside it.
        ...(art === "erinnerung" ? ["Der Link aus der ersten Anfrage funktioniert weiterhin."] : []),
      ],
    ],
    aktion: { label: "Spieltermin bestätigen", href: link },
  };
}

/** The first request for a fixture, to one mailbox of one of its teams. */
export function buildSpielAnfrageEmail(data: SpielAnfrageData): Mail {
  return buildAnfrage("anfrage", data);
}

/** The reminder, carrying a fresh link and the deadline the first request named. */
export function buildSpielErinnerungEmail(data: SpielAnfrageData): Mail {
  return buildAnfrage("erinnerung", data);
}

/**
 * The referee's word that they are booked. No token: the referee answers on their own panel, signed
 * in, so the control leads there rather than to a link page.
 */
export function buildSpielEinteilungEmail({ origin, ansetzung }: SpielEinteilungData): Mail {
  const site = mailOrigin(origin);

  return {
    art: "mitteilung",
    betreff: `Eingeteilt: ${ansetzung.team1} gegen ${ansetzung.team2} am ${ansetzung.datumText}`,
    origin: site,
    vorname: "",
    absaetze: [
      [
        [
          "Die Verwaltung der ",
          BRAND_NAME,
          " hat Dich als Schiedsrichterin oder Schiedsrichter für das Spiel ",
          ...paarung(ansetzung.team1, ansetzung.team2),
          " eingeteilt.",
        ],
      ],
    ],
    block: { fakten: termin(ansetzung) },
    // The area by its name on screen, read from its constant.
    nachBlock: [[`Nach der Anmeldung findest Du das Spiel auf der Website unter „${DEIN_BEREICH_TITEL}“.`, "Dort sagst Du zu oder ab."]],
    // The heading the button opens on, read from its constant.
    aktion: { label: EINSAETZE_TITEL, href: `${site}${SCHIEDSRICHTER_PANEL_PATH}` },
  };
}

/** What became of the earlier word, and what follows it, per reader: a team was asked, a referee booked. */
const NEU_SAETZE: Record<SpielEmpfaenger, readonly [string, string]> = {
  team: [
    "Die Anfrage zum bisherigen Termin und ihr Link gelten nicht mehr.",
    "Bleibt Dein Team in diesem Spiel, bekommst Du für einen neuen Termin nach dem heutigen Tag eine neue Anfrage.",
  ],
  schiedsrichter: [
    "Deine Einteilung zum bisherigen Termin gilt nicht mehr.",
    "Bleibst Du für das Spiel eingeteilt, bekommst Du für einen neuen Termin nach dem heutigen Tag eine neue Einteilung.",
  ],
};

/**
 * The word that a fixture a party was asked about has moved: sent from the sweep's close list, so a
 * move never leaves a mailbox holding a live-looking link. No new slot: the next request states it.
 */
export function buildSpielNeueAnsetzungEmail({ origin, team1, team2, altDatumText, altUhrzeitText, empfaenger }: SpielNeueAnsetzungData): Mail {
  return {
    art: "mitteilung",
    betreff: `Neu angesetzt: ${team1} gegen ${team2}`,
    origin: mailOrigin(origin),
    vorname: "",
    absaetze: [
      [["Das Spiel ", ...paarung(team1, team2), ", bisher am ", alterTermin(altDatumText, altUhrzeitText), ", ist neu angesetzt."]],
      NEU_SAETZE[empfaenger],
    ],
  };
}

/**
 * The word to a referee that their Einteilung is lifted, whoever took them off the fixture: no button, since nothing is
 * left for them to answer, and no name, since the address may have changed hands since the Einteilung.
 */
export function buildSpielEinteilungAufgehobenEmail({
  origin,
  team1,
  team2,
  altDatumText,
  altUhrzeitText,
}: SpielEinteilungAufgehobenData): Mail {
  return {
    art: "mitteilung",
    betreff: `Nicht mehr eingeteilt: ${team1} gegen ${team2}`,
    origin: mailOrigin(origin),
    vorname: "",
    absaetze: [
      [
        [
          "Für das Spiel ",
          ...paarung(team1, team2),
          " am ",
          alterTermin(altDatumText, altUhrzeitText),
          " bist Du nicht mehr als Schiedsrichterin oder Schiedsrichter eingeteilt.",
        ],
      ],
      ["Deine Einteilung zu diesem Spiel gilt nicht mehr.", "Du musst nichts tun."],
    ],
  };
}

/** What the call-off ends for each reader, and what a reinstated fixture brings: a team was asked, a referee booked. */
const ABGESAGT_SAETZE: Record<SpielEmpfaenger, readonly [string, string, string]> = {
  team: [
    "Die Anfrage zu diesem Spiel und ihr Link gelten nicht mehr.",
    "Du musst nichts tun.",
    "Wird das Spiel neu angesetzt, bekommst Du eine neue Anfrage.",
  ],
  schiedsrichter: [
    "Deine Einteilung zu diesem Spiel gilt nicht mehr.",
    "Du musst nichts tun.",
    "Wird das Spiel neu angesetzt, bekommst Du eine neue Einteilung.",
  ],
};

/**
 * The word that a fixture a party was asked about is called off, so nobody who agreed travels to it: no button, nothing
 * being left to answer, and no name, the address perhaps having changed hands since the request.
 */
export function buildSpielAbgesagtEmail({ origin, team1, team2, altDatumText, altUhrzeitText, empfaenger }: SpielAbgesagtData): Mail {
  return {
    art: "mitteilung",
    betreff: `Abgesagt: ${team1} gegen ${team2} am ${altDatumText}`,
    origin: mailOrigin(origin),
    vorname: "",
    absaetze: [
      [["Das Spiel ", ...paarung(team1, team2), " am ", alterTermin(altDatumText, altUhrzeitText), " ist abgesagt."]],
      ABGESAGT_SAETZE[empfaenger],
    ],
  };
}

/** What a club whose proposed date the league discarded is told: the slot it was asked about, which stands. */
export interface SpielVorschlagVerworfenData {
  readonly origin: string;
  readonly team1: string;
  readonly team2: string;
  readonly datumText: string;
  readonly uhrzeitText: string;
}

/**
 * The word to a club that the league kept the date it declined and proposed another for: its answer said the league
 * decides, and nothing else tells it the league has. No button, nothing being left to answer.
 */
export function buildSpielVorschlagVerworfenEmail({ origin, team1, team2, datumText, uhrzeitText }: SpielVorschlagVerworfenData): Mail {
  return {
    art: "mitteilung",
    betreff: `Termin bleibt: ${team1} gegen ${team2} am ${datumText}`,
    origin: mailOrigin(origin),
    vorname: "",
    absaetze: [
      [
        ["Für das Spiel ", ...paarung(team1, team2), " hat Dein Team einen anderen Termin vorgeschlagen."],
        ["Die Liga hat entschieden: Das Spiel bleibt am ", alterTermin(datumText, uhrzeitText), "."],
      ],
      ["Du musst nichts tun."],
    ],
  };
}
