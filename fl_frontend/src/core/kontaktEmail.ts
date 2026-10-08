import "server-only";

import { KONTAKT_EMAIL } from "./brand";
import {
  ANTWORT_SATZ_HTML,
  ANTWORT_SATZ_TEXT,
  art21Satz,
  ASIDE_TEXT,
  BRAND_NAME,
  brandPhrase,
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
import { kontaktBestaetigungsLink } from "./kontaktLink";

import type { Aktion } from "./emailShell";

const UEBERSCHRIFT = "Dein Eintrag als Kontaktperson";

/**
 * For the reader who never agreed to be a team's contact: an administrator typed this address, and
 * the link's second door is what takes the entry away again.
 */
const ignorierSatz = (kontakt: string): string =>
  `Du weißt nichts von diesem Eintrag? Dann widersprich ihm über den Link, oder schreib uns an ${kontakt}: Wir entfernen Deine Angaben dann.`;

/** Named per message, as every close is: a sentence saying who else read this has to be true of it. */
const EMPFAENGER_SATZ = "Diese E-Mail geht nur an Dich.";

export type KontaktEmail = { subject: string; html: string; text: string };

/**
 * The season row's state at the mint. Once the season is over or the team has left it, the link's
 * page takes the Widerspruch alone, so the message asks for no confirmation.
 */
export type KontaktZeile = "offen" | "saison_vorbei" | "ausgetreten";

/** What one person an administrator seated on a team's season row is asked to confirm. */
export interface KontaktBestaetigungData {
  /** The serving origin, never `fl_frontend/src/core/brand.ts :: SITE_URL` (`docs/frontend/spec.md :: I186`). */
  origin: string;
  vorname: string;
  /**
   * Every seat this one link answers for, as one phrase, rendered by the caller:
   * `fl_frontend/src/features/bewerbungen/notifications.ts :: rollenText` sits in a layer `core` may not reach.
   */
  rollenText: string;
  /** The team's name, which is the school the reader is asked about. */
  schule: string;
  saisonId: string;
  /** The raw token. It is a bearer credential and is never taken apart here. */
  token: string;
  /** The deadline as a German date, rendered by the caller for the reason `rollenText` is. */
  fristText: string;
  zeile: KontaktZeile;
}

/** One control, as the referee's message carries one: the message exists for this link alone. */
function aktionen(url: string, zeile: KontaktZeile): readonly Aktion[] {
  // Named for what the page offers: a closed row's page has nothing to confirm.
  return [{ href: url, label: zeile === "offen" ? "Eintrag bestätigen" : "Zum Eintrag", ton: "primary" }];
}

type Fakten = {
  vorname: string;
  rollen: string;
  schule: string;
  saisonId: string;
  frist: string;
  url: string;
  origin: string;
  zeile: KontaktZeile;
};

function eintragSatz({ vorname, rollen, schule, saisonId }: Fakten, markup: boolean): string {
  const name = markup ? strong(escapeHtml(vorname)) : vorname;
  const team = markup ? strong(escapeHtml(schule)) : schule;
  // Coloured as the registration and application messages colour the season they name.
  const saison = markup ? brandPhrase(`Saison ${escapeHtml(saisonId)}`) : `Saison ${saisonId}`;

  // „für {Team} in der Saison …“, as the registration messages name a team and its season.
  return `Hallo ${name}, die Verwaltung der ${BRAND_NAME} hat Dich in der ${saison} als ${markup ? escapeHtml(rollen) : rollen} für ${team} eingetragen.`;
}

// „Bereich“, the signed-in area's own name on screen, and never „Zugang“: on screen that word names an
// administrator's grant alone (`docs/glossary.md`), which a confirmed seat is not.
const DANACH_SATZ = "Erst danach findest Du Dein Team nach der Anmeldung auf der Website in Deinem Bereich.";

// Both answers are named before the press: a reader who came to object and meets a birthdate box was
// asked something the message did not say.
const SEITE_SATZ =
  "Auf der Seite bestätigst Du den Eintrag mit Deinem Geburtsdatum, oder Du widersprichst ihm, dann entfernen wir Deine Angaben daraus.";

/** Why a closed row's page offers no confirmation, in the page's own terms. */
const GESCHLOSSEN_SATZ: Record<Exclude<KontaktZeile, "offen">, string> = {
  saison_vorbei: "Die Saison ist vorbei, deshalb kannst Du den Eintrag nicht bestätigen.",
  ausgetreten: "Das Team spielt in dieser Saison nicht mehr mit, deshalb kannst Du den Eintrag nicht bestätigen.",
};

// The one answer such a page takes, worded as the page words it.
const WIDERSPRUCH_SATZ =
  "Möchtest Du nicht eingetragen bleiben, kannst Du über den Link widersprechen. Dann entfernen wir Deine Angaben aus dem Eintrag.";

/** The opening paragraph's ask, after the sentence naming the entry: a confirmation, or why there is none. */
function bitteSatz(zeile: KontaktZeile, markup: boolean): string {
  if (zeile !== "offen") return GESCHLOSSEN_SATZ[zeile];

  return `${markup ? strong("Bitte bestätige, dass das stimmt") : "Bitte bestätige, dass das stimmt"}: ${DANACH_SATZ}`;
}

/**
 * What the page takes and how long the link holds. No re-send on a closed row: the backend refuses
 * one there (`REQ-KONTAKT-005`), so the message promises none.
 */
function linkSaetze(zeile: KontaktZeile, frist: string): readonly string[] {
  const gueltig = `Der Link ist bis zum ${frist} gültig und funktioniert nur einmal.`;

  return zeile === "offen"
    ? [SEITE_SATZ, gueltig, "Ist er abgelaufen, schickt die Verwaltung Dir auf Wunsch einen neuen."]
    : [WIDERSPRUCH_SATZ, gueltig];
}

function renderHtml(fakten: Fakten): string {
  return renderKarte({
    titel: `${BRAND_NAME}: ${UEBERSCHRIFT}`,
    ueberschrift: escapeHtml(UEBERSCHRIFT),
    bloecke: [
      paragraph(`${eintragSatz(fakten, true)} ${bitteSatz(fakten.zeile, true)}`),
      paragraph(linkSaetze(fakten.zeile, strong(escapeHtml(fakten.frist))).join(" ")),
      // The address as a marked link: one a reader has to select and paste is not a route.
      paragraph(art21Satz(link(`mailto:${KONTAKT_EMAIL}`, KONTAKT_EMAIL))),
      ...fallbackBloecke([{ label: "", url: fakten.url }], FALLBACK_SATZ),
      paragraph(ignorierSatz(link(`mailto:${KONTAKT_EMAIL}`, KONTAKT_EMAIL)), "0", ASIDE_TEXT),
    ],
    aktionen: aktionen(fakten.url, fakten.zeile),
    fuss: `${EMPFAENGER_SATZ} ${ANTWORT_SATZ_HTML}`,
    origin: fakten.origin,
  });
}

function renderText(fakten: Fakten): string {
  const oben = [
    `${BRAND_NAME}: ${UEBERSCHRIFT}`,
    "",
    eintragSatz(fakten, false),
    bitteSatz(fakten.zeile, false),
    "",
    ...linkSaetze(fakten.zeile, fakten.frist),
    "",
    art21Satz(KONTAKT_EMAIL),
    "",
    fakten.url,
    "",
    ignorierSatz(KONTAKT_EMAIL),
  ];

  return [stuffSignatureDelimiter(oben.join("\n")), ...textFooter(fakten.origin, [EMPFAENGER_SATZ, ANTWORT_SATZ_TEXT])].join("\n");
}

/**
 * **The two parts state the same facts**, as in the application messages
 * (`fl_frontend/src/core/bewerbungEmail.ts :: buildBewerbungBestaetigungEmail`).
 */
export function buildKontaktBestaetigungEmail({
  origin,
  vorname,
  rollenText,
  schule,
  saisonId,
  token,
  fristText,
  zeile,
}: KontaktBestaetigungData): KontaktEmail {
  const site = mailOrigin(origin);
  // Folded before either branch, and the subject with them: this message renders no fact panel, so
  // nothing downstream would fold these, and a break in a subject is a header injection.
  const fakten: Fakten = {
    vorname: einzeilig(vorname),
    rollen: einzeilig(rollenText),
    schule: einzeilig(schule),
    saisonId: einzeilig(saisonId),
    frist: einzeilig(fristText),
    url: kontaktBestaetigungsLink(site, token),
    origin: site,
    zeile: zeile,
  };

  return {
    subject: `Du bist als ${fakten.rollen} für ${fakten.schule} eingetragen`,
    html: renderHtml(fakten),
    text: renderText(fakten),
  };
}
