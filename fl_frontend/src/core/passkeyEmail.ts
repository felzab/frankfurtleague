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

/** The administrator's own surface, which is the only place either event can be acted on. */
const ZIEL_LABEL = "Zur Verwaltung";

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
  betreff: `Neuer Passkey für Deinen Zugang zur ${BRAND_NAME}`,
  satz: (zeit) => `Deinem Zugang wurde am ${zeit} ein Passkey hinzugefügt.`,
};

const GELOESCHT: Ereignis = {
  ueberschrift: "Passkey gelöscht",
  betreff: `Passkey für Deinen Zugang zur ${BRAND_NAME} gelöscht`,
  satz: (zeit) => `Von Deinem Zugang wurde am ${zeit} ein Passkey gelöscht. Alle anderen Geräte wurden dabei abgemeldet.`,
};

function aktionen(origin: string): readonly Aktion[] {
  // eslint-disable-next-line local/admin-link -- a link inside a message, followed from an inbox days later; no season is in scope at composing time
  return [{ href: `${origin}/bereich/admin`, label: ZIEL_LABEL, ton: "primary" }];
}

function renderHtml(ereignis: Ereignis, zeit: string, origin: string): string {
  return renderKarte({
    titel: `${BRAND_NAME}: ${ereignis.ueberschrift}`,
    ueberschrift: escapeHtml(ereignis.ueberschrift),
    bloecke: [paragraph(ereignis.satz(strong(escapeHtml(zeit)))), paragraph(WARNSATZ, "0", ASIDE_TEXT)],
    aktionen: aktionen(origin),
    fuss: ANTWORT_SATZ_HTML,
    origin: origin,
  });
}

function renderText(ereignis: Ereignis, zeit: string, origin: string): string {
  const oben = [`${BRAND_NAME}: ${ereignis.ueberschrift}`, "", ereignis.satz(zeit), "", `${ZIEL_LABEL}: ${origin}/bereich/admin`, "", WARNSATZ];

  return [stuffSignatureDelimiter(oben.join("\n")), ...textFooter(origin, [ANTWORT_SATZ_TEXT])].join("\n");
}

function build(ereignis: Ereignis, zeitpunkt: Date, origin: string): PasskeyEmail {
  const site = mailOrigin(origin);
  const zeit = zeitText(zeitpunkt);

  return { subject: ereignis.betreff, html: renderHtml(ereignis, zeit, site), text: renderText(ereignis, zeit, site) };
}

/**
 * **The two parts state the same facts**, as in the application messages
 * (`fl_frontend/src/core/bewerbungEmail.ts :: buildBewerbungZusageEmail`).
 */
export function buildPasskeyHinzugefuegtEmail({ zeitpunkt, origin }: { zeitpunkt: Date; origin: string }): PasskeyEmail {
  return build(HINZUGEFUEGT, zeitpunkt, origin);
}

export function buildPasskeyGeloeschtEmail({ zeitpunkt, origin }: { zeitpunkt: Date; origin: string }): PasskeyEmail {
  return build(GELOESCHT, zeitpunkt, origin);
}
