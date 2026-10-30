import "server-only";

import { COPY } from "./copy";
import { BRAND_NAME, mailOrigin } from "./emailShell";
import { formatDatum, formatUhrzeit } from "./format";
import { DEIN_BEREICH_TITEL, EINSAETZE_TITEL } from "./seitenNamen";

import type { Fakt, Lauf, Mail } from "./emailShell";
import type { Kalendertag, Uhrzeit } from "./format";
import type {
  FLSpielAnfrageDaten,
  FLSpielEinteilungAufgehobenDaten,
  FLSpielEinteilungDaten,
  FLSpielHinweisDaten,
  FLSpielMailAnsetzung,
  FLSpielVorschlagVerworfenDaten,
} from "./generated/client/types";
import type { MailLink, MailOrt } from "./mailKinds";

/** Under the segment `fl_frontend/src/app/robots.ts` already turns crawlers back from, so a live token is never indexed. */
export const SPIEL_BESTAETIGUNG_PATH = "/bestaetigung/spiel";

/**
 * The one place this link is spelled. `token` is the name `nginx/shared/http.conf :: $credential_free_uri`
 * redacts, and the origin goes through `mailOrigin` here, so the link and the message's close stand on one host.
 */
export function spielBestaetigungsLink(origin: string, token: string): string {
  return `${mailOrigin(origin)}${SPIEL_BESTAETIGUNG_PATH}?token=${encodeURIComponent(token)}`;
}

/** One fixture as a message states it. No person, the referee included. */
interface SpielAnsetzungText {
  /** The two sides in the fixture's own order, as the schedule lists them. */
  readonly team1: string;
  readonly team2: string;
  readonly datumText: string;
  readonly uhrzeitText: string;
  readonly ortText: string;
}

const datumText = (datum: string): string => formatDatum(datum as Kalendertag);

const uhrzeitText = (uhrzeit: string): string => formatUhrzeit(uhrzeit as Uhrzeit);

/** The fixture as the row's facts hold it, its dates as the site prints them, a ground nobody assigned in the fixtures' word. */
function ansetzungText({ team1, team2, datum, uhrzeit, ort }: FLSpielMailAnsetzung): SpielAnsetzungText {
  return {
    team1: team1,
    team2: team2,
    datumText: datumText(datum),
    uhrzeitText: uhrzeitText(uhrzeit),
    ortText: ort ?? COPY.shared.nichtHinterlegt,
  };
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
const alterTermin = (datum: string, uhrzeit: string): Lauf => ({ stark: `${datumText(datum)} um ${uhrzeitText(uhrzeit)} Uhr` });

/**
 * A club's request to confirm a fixture, or the reminder of it, to one mailbox of one of its teams. No name and no seat:
 * the administrator typed this address, so behind a typo its reader is a stranger, owed none.
 */
export function buildSpielAnfrageEmail({ art, team, ansetzung: facts, frist }: FLSpielAnfrageDaten, { origin, token }: MailLink): Mail {
  const ansetzung = ansetzungText(facts);
  const spiel = `${ansetzung.team1} gegen ${ansetzung.team2} am ${ansetzung.datumText}`;

  return {
    art: "mitteilung",
    betreff: art === "spiel_anfrage" ? `Bitte bestätigen: ${spiel}` : `Erinnerung: ${spiel} bestätigen`,
    // Through `mailOrigin` once, for the footer: the link is spelled by its own function, so a second derivation here
    // could send the two versions to different hosts.
    origin: mailOrigin(origin),
    vorname: "",
    absaetze: [
      [
        // The first request says the fixture is set, the reminder that the team's answer is still owed.
        art === "spiel_anfrage"
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
        ["Bitte antworte bis zum ", { stark: datumText(frist) }, "."],
        "Es gilt die erste Antwort aus Deinem Team, danach funktioniert der Link nicht mehr.",
        "Kommt bis dahin keine Antwort, legt die Verwaltung der Liga den Termin fest.",
        // A reminder carries a fresh link, and the first request's still answers beside it.
        ...(art === "spiel_erinnerung" ? ["Der Link aus der ersten Anfrage funktioniert weiterhin."] : []),
      ],
    ],
    aktion: { label: "Spieltermin bestätigen", href: spielBestaetigungsLink(origin, token) },
  };
}

/**
 * The referee's word that they are booked. No token: the referee answers on their own panel, signed
 * in, so the control leads there rather than to a link page.
 */
export function buildSpielEinteilungEmail({ ansetzung: facts }: FLSpielEinteilungDaten, { origin }: MailOrt): Mail {
  const site = mailOrigin(origin);
  const ansetzung = ansetzungText(facts);

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
const NEU_SAETZE: Record<FLSpielHinweisDaten["empfaenger"], readonly [string, string]> = {
  team: [
    "Die Anfrage zum bisherigen Termin und ihr Link gelten nicht mehr.",
    "Bleibt Dein Team in diesem Spiel, bekommst Du für einen neuen Termin nach dem heutigen Tag eine neue Anfrage.",
  ],
  schiedsrichter: [
    "Deine Einteilung zum bisherigen Termin gilt nicht mehr.",
    "Bleibst Du für das Spiel eingeteilt, bekommst Du für einen neuen Termin nach dem heutigen Tag eine neue Einteilung.",
  ],
};

/** What the call-off ends for each reader, and what a reinstated fixture brings: a team was asked, a referee booked. */
const ABGESAGT_SAETZE: Record<FLSpielHinweisDaten["empfaenger"], readonly [string, string, string]> = {
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
 * The word that a fixture a party was asked about has moved, or been called off: the slot it was asked about, the one
 * it knows. A move names no new slot, the next request stating it; a call-off has no button and no name, nothing being
 * left to answer and the address perhaps having changed hands since the request.
 */
export function buildSpielHinweisEmail({ art, empfaenger, termin: alt }: FLSpielHinweisDaten, { origin }: MailOrt): Mail {
  const { team1, team2 } = alt;

  if (art === "spiel_neu_angesetzt") {
    return {
      art: "mitteilung",
      betreff: `Neu angesetzt: ${team1} gegen ${team2}`,
      origin: mailOrigin(origin),
      vorname: "",
      absaetze: [
        [["Das Spiel ", ...paarung(team1, team2), ", bisher am ", alterTermin(alt.datum, alt.uhrzeit), ", ist neu angesetzt."]],
        NEU_SAETZE[empfaenger],
      ],
    };
  }

  return {
    art: "mitteilung",
    betreff: `Abgesagt: ${team1} gegen ${team2} am ${datumText(alt.datum)}`,
    origin: mailOrigin(origin),
    vorname: "",
    absaetze: [
      [["Das Spiel ", ...paarung(team1, team2), " am ", alterTermin(alt.datum, alt.uhrzeit), " ist abgesagt."]],
      ABGESAGT_SAETZE[empfaenger],
    ],
  };
}

/**
 * The word to a referee that their Einteilung is lifted, whoever took them off the fixture: no button, since nothing is
 * left for them to answer, and no name, since the address may have changed hands since the Einteilung.
 */
export function buildSpielEinteilungAufgehobenEmail({ termin: alt }: FLSpielEinteilungAufgehobenDaten, { origin }: MailOrt): Mail {
  return {
    art: "mitteilung",
    betreff: `Nicht mehr eingeteilt: ${alt.team1} gegen ${alt.team2}`,
    origin: mailOrigin(origin),
    vorname: "",
    absaetze: [
      [
        [
          "Für das Spiel ",
          ...paarung(alt.team1, alt.team2),
          " am ",
          alterTermin(alt.datum, alt.uhrzeit),
          " bist Du nicht mehr als Schiedsrichterin oder Schiedsrichter eingeteilt.",
        ],
      ],
      ["Deine Einteilung zu diesem Spiel gilt nicht mehr.", "Du musst nichts tun."],
    ],
  };
}

/**
 * The word to a club that the league kept the date it declined and proposed another for: its answer said the league
 * decides, and nothing else tells it the league has. No button, nothing being left to answer.
 */
export function buildSpielVorschlagVerworfenEmail({ termin: alt }: FLSpielVorschlagVerworfenDaten, { origin }: MailOrt): Mail {
  return {
    art: "mitteilung",
    betreff: `Termin bleibt: ${alt.team1} gegen ${alt.team2} am ${datumText(alt.datum)}`,
    origin: mailOrigin(origin),
    vorname: "",
    absaetze: [
      [
        ["Für das Spiel ", ...paarung(alt.team1, alt.team2), " hat Dein Team einen anderen Termin vorgeschlagen."],
        ["Die Liga hat entschieden: Das Spiel bleibt am ", alterTermin(alt.datum, alt.uhrzeit), "."],
      ],
      ["Du musst nichts tun."],
    ],
  };
}
