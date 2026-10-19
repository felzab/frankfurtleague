import "server-only";

import { KONTAKT_EMAIL } from "./brand";
import {
  ANTWORT_SATZ_HTML,
  ANTWORT_SATZ_TEXT,
  ASIDE_TEXT,
  BRAND_NAME,
  einzeilig,
  escapeHtml,
  FALLBACK_SATZ,
  fallbackBloecke,
  link,
  mailOrigin,
  paragraph,
  renderKarte,
  strong,
  stuffSignatureDelimiter,
  textFooter,
} from "./emailShell";
import { DEIN_BEREICH_TITEL } from "./seitenNamen";

import type { Aktion } from "./emailShell";

export type SpielEmail = { subject: string; html: string; text: string };

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
  /** The serving origin, never `fl_frontend/src/core/brand.ts :: SITE_URL` (`docs/frontend/spec.md :: I186`). */
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

/** The referee's own panel, the address `fl_frontend/src/features/funktionen/utils.ts` opens their Funktion on. */
const SCHIEDSRICHTER_PANEL_PATH = "/bereich/schiedsrichter";

const ANFRAGE_UEBERSCHRIFT = "Spieltermin bestätigen";
const ERINNERUNG_UEBERSCHRIFT = "Erinnerung: Spieltermin bestätigen";
const EINTEILUNG_UEBERSCHRIFT = "Einteilung als Schiedsrichterin oder Schiedsrichter";
const NEU_UEBERSCHRIFT = "Spiel neu angesetzt";

/** Every seat of a team is mailed alike, so the close says who else read it. */
const TEAM_EMPFAENGER_SATZ = "Diese E-Mail geht an die Kontaktpersonen Deines Teams.";
const EINZEL_EMPFAENGER_SATZ = "Diese E-Mail geht nur an Dich.";

/** Every value folded once, before any part or the subject prints it: these messages render no column of facts that would fold them (`docs/frontend/spec.md :: I89`). */
function gefaltet(ansetzung: SpielAnsetzungText): SpielAnsetzungText {
  return {
    team1: einzeilig(ansetzung.team1),
    team2: einzeilig(ansetzung.team2),
    datumText: einzeilig(ansetzung.datumText),
    uhrzeitText: einzeilig(ansetzung.uhrzeitText),
    ortText: einzeilig(ansetzung.ortText),
  };
}

/** The pairing as the copy rules spell one: the two clubs by name, joined by „gegen“. */
function paarung(team1: string, team2: string, markup: boolean): string {
  return markup ? `${strong(escapeHtml(team1))} gegen ${strong(escapeHtml(team2))}` : `${team1} gegen ${team2}`;
}

/** The slot, one fact to a line in the text part and to a break in the card, so a reader scanning for the day finds it alone. */
function terminZeilen({ datumText, uhrzeitText, ortText }: SpielAnsetzungText): readonly [string, string] {
  return [`Termin: ${datumText}, ${uhrzeitText} Uhr`, `Ort: ${ortText}`];
}

function terminHtml({ datumText, uhrzeitText, ortText }: SpielAnsetzungText): string {
  return paragraph(
    `${strong("Termin")}: ${escapeHtml(datumText)}, ${escapeHtml(uhrzeitText)} Uhr<br />${strong("Ort")}: ${escapeHtml(ortText)}`,
  );
}

/** Both answers named before the press, as the page offers both: a reader expecting one button meets two. */
const bitteSatz = (team: string): string => `Bitte bestätige den Termin für ${team} oder schlag einen anderen vor.`;

/**
 * The deadline, the first-press rule and what silence costs. Any of the team's seats answers, the first
 * press binding, so a reader told nothing of it takes a colleague's answer for a dead link.
 */
function fristSaetze(frist: string): readonly string[] {
  return [
    `Bitte antworte bis zum ${frist}.`,
    "Es gilt die erste Antwort aus Deinem Team, danach funktioniert der Link nicht mehr.",
    "Kommt bis dahin keine Antwort, legt die Verwaltung den Termin fest.",
  ];
}

/** For the reader an administrator typed in by mistake: the link answers for a team they are not part of. */
const fremdSatz = (team: string, kontakt: string): string =>
  `Du hast mit ${team} nichts zu tun? Dann antworte nicht über den Link, sondern schreib uns an ${kontakt}.`;

/** One control, as every link message carries one: the message exists for this link alone. */
function anfrageAktionen(url: string): readonly Aktion[] {
  return [{ href: url, label: "Termin bestätigen", ton: "primary" }];
}

type AnfrageArt = "anfrage" | "erinnerung";

type AnfrageFakten = { link: string; team: string; ansetzung: SpielAnsetzungText; frist: string; origin: string };

/** The opening: the first request says the fixture is set, the reminder that the team's answer is still owed. */
function eroeffnung(art: AnfrageArt, { ansetzung }: AnfrageFakten, markup: boolean): string {
  const spiel = paarung(ansetzung.team1, ansetzung.team2, markup);

  return art === "anfrage"
    ? `Hallo, die Verwaltung der ${BRAND_NAME} hat das Spiel ${spiel} angesetzt.`
    : `Hallo, für das Spiel ${spiel} steht die Antwort Deines Teams noch aus.`;
}

/** A reminder carries a fresh link, and the first request's still answers beside it. */
const ERINNERUNG_LINK_SATZ = "Der Link aus der ersten Anfrage funktioniert weiterhin.";

function anfrageHtml(art: AnfrageArt, fakten: AnfrageFakten, ueberschrift: string): string {
  const frist = fristSaetze(strong(escapeHtml(fakten.frist)));

  return renderKarte({
    titel: `${BRAND_NAME}: ${ueberschrift}`,
    ueberschrift: escapeHtml(ueberschrift),
    bloecke: [
      paragraph(`${eroeffnung(art, fakten, true)} ${strong(escapeHtml(bitteSatz(fakten.team)))}`),
      terminHtml(fakten.ansetzung),
      paragraph([...frist, ...(art === "erinnerung" ? [ERINNERUNG_LINK_SATZ] : [])].join(" ")),
      ...fallbackBloecke([{ label: "", url: fakten.link }], FALLBACK_SATZ),
      // The address as a marked link: one a reader has to select and paste is not a route.
      paragraph(fremdSatz(escapeHtml(fakten.team), link(`mailto:${KONTAKT_EMAIL}`, KONTAKT_EMAIL)), "0", ASIDE_TEXT),
    ],
    aktionen: anfrageAktionen(fakten.link),
    fuss: `${TEAM_EMPFAENGER_SATZ} ${ANTWORT_SATZ_HTML}`,
    origin: fakten.origin,
  });
}

function anfrageText(art: AnfrageArt, fakten: AnfrageFakten, ueberschrift: string): string {
  const oben = [
    `${BRAND_NAME}: ${ueberschrift}`,
    "",
    eroeffnung(art, fakten, false),
    bitteSatz(fakten.team),
    "",
    ...terminZeilen(fakten.ansetzung),
    "",
    ...fristSaetze(fakten.frist),
    ...(art === "erinnerung" ? [ERINNERUNG_LINK_SATZ] : []),
    "",
    fakten.link,
    "",
    fremdSatz(fakten.team, KONTAKT_EMAIL),
  ];

  return [stuffSignatureDelimiter(oben.join("\n")), ...textFooter(fakten.origin, [TEAM_EMPFAENGER_SATZ, ANTWORT_SATZ_TEXT])].join("\n");
}

function buildAnfrage(art: AnfrageArt, data: SpielAnfrageData): SpielEmail {
  // Through `mailOrigin` once, for the close: the link is spelled by its own module and arrives
  // finished, so a second derivation here could send the two halves to different hosts.
  const site = mailOrigin(data.origin);
  const fakten: AnfrageFakten = {
    link: einzeilig(data.link),
    team: einzeilig(data.team),
    ansetzung: gefaltet(data.ansetzung),
    frist: einzeilig(data.fristText),
    origin: site,
  };
  const ueberschrift = art === "anfrage" ? ANFRAGE_UEBERSCHRIFT : ERINNERUNG_UEBERSCHRIFT;
  const spiel = `${fakten.ansetzung.team1} gegen ${fakten.ansetzung.team2} am ${fakten.ansetzung.datumText}`;

  return {
    subject: art === "anfrage" ? `Bitte bestätigen: ${spiel}` : `Erinnerung: ${spiel} bestätigen`,
    html: anfrageHtml(art, fakten, ueberschrift),
    text: anfrageText(art, fakten, ueberschrift),
  };
}

/**
 * The first request for a fixture, to one mailbox of one of its teams. **The two parts state the same
 * facts**, as in the application messages (`fl_frontend/src/core/bewerbungEmail.ts :: buildBewerbungBestaetigungEmail`).
 */
export function buildSpielAnfrageEmail(data: SpielAnfrageData): SpielEmail {
  return buildAnfrage("anfrage", data);
}

/** The reminder, carrying a fresh link and the deadline the first request named. */
export function buildSpielErinnerungEmail(data: SpielAnfrageData): SpielEmail {
  return buildAnfrage("erinnerung", data);
}

/**
 * The referee's word that they are booked. No token: the referee answers on their own panel, signed
 * in, so the control leads there rather than to a link page.
 */
export function buildSpielEinteilungEmail({ origin, ansetzung }: SpielEinteilungData): SpielEmail {
  const site = mailOrigin(origin);
  const fakten = gefaltet(ansetzung);
  const panel = `${site}${SCHIEDSRICHTER_PANEL_PATH}`;
  const label = "Zu Deinen Spielen";

  const eingeteilt = (markup: boolean): string =>
    `Hallo, die Verwaltung der ${BRAND_NAME} hat Dich als Schiedsrichterin oder Schiedsrichter für das Spiel ${paarung(fakten.team1, fakten.team2, markup)} eingeteilt.`;
  // The area by its name on screen, read from its constant (`docs/frontend/spec.md` §1.12).
  const bereich = `Nach der Anmeldung findest Du das Spiel auf der Website unter „${DEIN_BEREICH_TITEL}“. Dort sagst Du zu oder ab.`;

  const html = renderKarte({
    titel: `${BRAND_NAME}: ${EINTEILUNG_UEBERSCHRIFT}`,
    ueberschrift: escapeHtml(EINTEILUNG_UEBERSCHRIFT),
    bloecke: [paragraph(eingeteilt(true)), terminHtml(fakten), paragraph(escapeHtml(bereich))],
    aktionen: [{ href: panel, label: label, ton: "primary" }],
    fuss: `${EINZEL_EMPFAENGER_SATZ} ${ANTWORT_SATZ_HTML}`,
    origin: site,
  });

  const oben = [
    `${BRAND_NAME}: ${EINTEILUNG_UEBERSCHRIFT}`,
    "",
    eingeteilt(false),
    "",
    ...terminZeilen(fakten),
    "",
    bereich,
    "",
    `${label}: ${panel}`,
  ];

  return {
    subject: `Eingeteilt: ${fakten.team1} gegen ${fakten.team2} am ${fakten.datumText}`,
    html: html,
    text: [stuffSignatureDelimiter(oben.join("\n")), ...textFooter(site, [EINZEL_EMPFAENGER_SATZ, ANTWORT_SATZ_TEXT])].join("\n"),
  };
}

/** What became of the earlier word, and what follows it, per reader: a team was asked, a referee booked. */
const NEU_SAETZE: Record<SpielEmpfaenger, readonly string[]> = {
  team: ["Die Anfrage zum bisherigen Termin und ihr Link gelten nicht mehr.", "Zum neuen Termin bekommst Du eine neue Anfrage."],
  schiedsrichter: [
    "Deine Einteilung zum bisherigen Termin gilt nicht mehr.",
    "Bleibst Du für das Spiel eingeteilt, bekommst Du zum neuen Termin eine neue Einteilung.",
  ],
};

/**
 * The word that a fixture a party was asked about has moved: sent from the sweep's close list, so a
 * move never leaves a mailbox holding a live-looking link. No new slot: the next request states it.
 */
export function buildSpielNeueAnsetzungEmail({
  origin,
  team1,
  team2,
  altDatumText,
  altUhrzeitText,
  empfaenger,
}: SpielNeueAnsetzungData): SpielEmail {
  const site = mailOrigin(origin);
  const fakten = {
    team1: einzeilig(team1),
    team2: einzeilig(team2),
    datum: einzeilig(altDatumText),
    uhrzeit: einzeilig(altUhrzeitText),
  };
  const saetze = NEU_SAETZE[empfaenger];
  const empfaengerSatz = empfaenger === "team" ? TEAM_EMPFAENGER_SATZ : EINZEL_EMPFAENGER_SATZ;

  const verlegt = (markup: boolean): string => {
    const termin = markup
      ? strong(`${escapeHtml(fakten.datum)} um ${escapeHtml(fakten.uhrzeit)} Uhr`)
      : `${fakten.datum} um ${fakten.uhrzeit} Uhr`;

    return `Hallo, das Spiel ${paarung(fakten.team1, fakten.team2, markup)}, bisher am ${termin}, ist neu angesetzt.`;
  };

  const html = renderKarte({
    titel: `${BRAND_NAME}: ${NEU_UEBERSCHRIFT}`,
    ueberschrift: escapeHtml(NEU_UEBERSCHRIFT),
    bloecke: [paragraph(verlegt(true)), paragraph(saetze.map(escapeHtml).join(" "))],
    aktionen: [],
    fuss: `${empfaengerSatz} ${ANTWORT_SATZ_HTML}`,
    origin: site,
  });

  const oben = [`${BRAND_NAME}: ${NEU_UEBERSCHRIFT}`, "", verlegt(false), "", ...saetze];

  return {
    subject: `Neu angesetzt: ${fakten.team1} gegen ${fakten.team2}`,
    html: html,
    text: [stuffSignatureDelimiter(oben.join("\n")), ...textFooter(site, [empfaengerSatz, ANTWORT_SATZ_TEXT])].join("\n"),
  };
}
