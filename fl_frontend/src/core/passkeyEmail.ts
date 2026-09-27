import "server-only";

import {
  ANTWORT_SATZ_HTML,
  ANTWORT_SATZ_TEXT,
  ASIDE_TEXT,
  BRAND_NAME,
  escapeHtml,
  mailOrigin,
  paragraph,
  renderKarte,
  strong,
  stuffSignatureDelimiter,
  textFooter,
} from "./emailShell";

import type { Aktion } from "./emailShell";

export type PasskeyEmail = { subject: string; html: string; text: string };

/**
 * Named here rather than taken from the server's clock: the image runs UTC, and a notice a reader
 * checks against their own evening has to be stamped in the zone they live in.
 */
const ZEITZONE = "Europe/Berlin";

/** The reader's own account page, which is the only place either event can be acted on. */
const ZIEL_LABEL = "Zu Deinem Konto";

/**
 * What a reader does with the notice, and the whole of why it is sent: an enrolment they did not
 * make is the one signal that a session of theirs is somebody else's.
 */
const WARNSATZ = "Warst Du das nicht? Dann melde Dich sofort bei uns.";

function zeitText(zeitpunkt: Date): string {
  return zeitpunkt.toLocaleString("de-DE", { timeZone: ZEITZONE, dateStyle: "long", timeStyle: "short" });
}

/** The heading, the sentence and the subject of one event; nothing here names a row or a device. */
interface Ereignis {
  readonly ueberschrift: string;
  readonly betreff: string;
  readonly satz: (zeit: string) => string;
}

const HINZUGEFUEGT: Ereignis = {
  ueberschrift: "Neuer Passkey",
  betreff: `Neuer Passkey für Dein Konto bei der ${BRAND_NAME}`,
  satz: (zeit) => `Deinem Konto wurde am ${zeit} ein Passkey hinzugefügt.`,
};

const GELOESCHT: Ereignis = {
  ueberschrift: "Passkey gelöscht",
  betreff: `Passkey für Dein Konto bei der ${BRAND_NAME} gelöscht`,
  // Only the devices that passkey signed in: a removal ends the sessions carrying its credential and
  // leaves every other standing (`fl_frontend/src/core/auth.ts :: removePasskey`).
  satz: (zeit) => `Von Deinem Konto wurde am ${zeit} ein Passkey gelöscht. Geräte, die damit angemeldet waren, wurden abgemeldet.`,
};

function aktionen(origin: string, konto: string): readonly Aktion[] {
  return [{ href: `${origin}${konto}`, label: ZIEL_LABEL, ton: "primary" }];
}

function renderHtml(ereignis: Ereignis, zeit: string, origin: string, konto: string): string {
  return renderKarte({
    titel: `${BRAND_NAME}: ${ereignis.ueberschrift}`,
    ueberschrift: escapeHtml(ereignis.ueberschrift),
    bloecke: [paragraph(ereignis.satz(strong(escapeHtml(zeit)))), paragraph(WARNSATZ, "0", ASIDE_TEXT)],
    aktionen: aktionen(origin, konto),
    fuss: ANTWORT_SATZ_HTML,
    origin: origin,
  });
}

function renderText(ereignis: Ereignis, zeit: string, origin: string, konto: string): string {
  const oben = [`${BRAND_NAME}: ${ereignis.ueberschrift}`, "", ereignis.satz(zeit), "", `${ZIEL_LABEL}: ${origin}${konto}`, "", WARNSATZ];

  return [stuffSignatureDelimiter(oben.join("\n")), ...textFooter(origin, [ANTWORT_SATZ_TEXT])].join("\n");
}

/** What a builder is handed; `konto` is a path on `origin`, one area's account page (`fl_frontend/src/core/kontoHref.ts`). */
type Anlass = { zeitpunkt: Date; origin: string; konto: string };

function build(ereignis: Ereignis, { zeitpunkt, origin, konto }: Anlass): PasskeyEmail {
  const site = mailOrigin(origin);
  const zeit = zeitText(zeitpunkt);

  return { subject: ereignis.betreff, html: renderHtml(ereignis, zeit, site, konto), text: renderText(ereignis, zeit, site, konto) };
}

/**
 * **The two parts state the same facts**, as in the application messages
 * (`fl_frontend/src/core/bewerbungEmail.ts :: buildBewerbungZusageEmail`).
 */
export function buildPasskeyHinzugefuegtEmail(anlass: Anlass): PasskeyEmail {
  return build(HINZUGEFUEGT, anlass);
}

export function buildPasskeyGeloeschtEmail(anlass: Anlass): PasskeyEmail {
  return build(GELOESCHT, anlass);
}
