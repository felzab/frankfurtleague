import "server-only";

import { KONTAKT_EMAIL } from "./brand";
import {
  ANTWORT_SATZ_HTML,
  ANTWORT_SATZ_TEXT,
  ASIDE_TEXT,
  BRAND_NAME,
  escapeHtml,
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

// Spelled here as well as in `fl_frontend/src/core/schiedsrichterEmail.ts :: FALLBACK_SATZ`: one
// situation reads as one sentence to the person meeting it, so the two move together.
const FALLBACK_SATZ = "Falls der Button nicht funktioniert, kopiere diese Adresse in Deinen Browser:";

/** Named per message, as every close is: a sentence saying who else read this has to be true of it. */
const EMPFAENGER_SATZ = "Diese E-Mail geht nur an Dich.";

// A paragraph and a line group of its own: Art. 21(4) DSGVO asks the objection to reach a person at
// the first contact, apart from every other piece of information, the entry's own Widerspruch included.
const art21Satz = (adresse: string): string =>
  `Der Verarbeitung Deiner Angaben kannst Du jederzeit aus Gründen widersprechen, die sich aus Deiner besonderen Situation ergeben (Art. 21 DSGVO); eine formlose E-Mail an ${adresse} genügt.`;

export type KontaktEmail = { subject: string; html: string; text: string };

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
}

/**
 * One line, whatever was typed. The text branch is line-oriented, so a break here is its injection:
 * the value would render a line the reader cannot tell from the facts around it.
 */
function einzeilig(value: string): string {
  return value.replace(/[\r\n]+/g, " ");
}

/** One control, as the referee's message carries one: the message exists for this link alone. */
function aktionen(url: string): readonly Aktion[] {
  return [{ href: url, label: "Eintrag bestätigen", ton: "primary" }];
}

type Fakten = { vorname: string; rollen: string; schule: string; saisonId: string; frist: string; url: string; origin: string };

function eintragSatz({ vorname, rollen, schule, saisonId }: Fakten, markup: boolean): string {
  const name = markup ? strong(escapeHtml(vorname)) : vorname;
  const team = markup ? strong(escapeHtml(schule)) : schule;

  return `Hallo ${name}, die Verwaltung der ${BRAND_NAME} hat Dich für die Saison ${markup ? escapeHtml(saisonId) : saisonId} als ${markup ? escapeHtml(rollen) : rollen} von ${team} eingetragen.`;
}

// Both answers are named before the press: a reader who came to object and meets a birthdate box was
// asked something the message did not say.
const SEITE_SATZ =
  "Auf der Seite bestätigst Du den Eintrag mit Deinem Geburtsdatum, oder Du widersprichst ihm, dann entfernen wir Deine Angaben daraus.";

function renderHtml(fakten: Fakten): string {
  return renderKarte({
    titel: `${BRAND_NAME}: ${UEBERSCHRIFT}`,
    ueberschrift: escapeHtml(UEBERSCHRIFT),
    bloecke: [
      paragraph(
        `${eintragSatz(fakten, true)} ${strong("Bitte bestätige, dass das stimmt")}: Erst danach erhältst Du über die Anmeldung auf der Website Zugang zu Deinem Team.`,
      ),
      paragraph(
        `${SEITE_SATZ} Der Link ist bis zum ${strong(escapeHtml(fakten.frist))} gültig und funktioniert nur einmal. Ist er abgelaufen, schickt die Verwaltung Dir auf Wunsch einen neuen.`,
      ),
      // The address as a marked link: one a reader has to select and paste is not a route.
      paragraph(art21Satz(link(`mailto:${KONTAKT_EMAIL}`, KONTAKT_EMAIL))),
      paragraph(FALLBACK_SATZ, "0 0 8px", ASIDE_TEXT),
      /* The link runs past the card's width, so this one paragraph breaks inside a word. Marked as a
         link as well: an address a reader has to select and paste is not a route. */
      paragraph(link(fakten.url, fakten.url), "0 0 16px", `${ASIDE_TEXT}word-break:break-all;`),
      paragraph(ignorierSatz(link(`mailto:${KONTAKT_EMAIL}`, KONTAKT_EMAIL)), "0", ASIDE_TEXT),
    ],
    aktionen: aktionen(fakten.url),
    fuss: `${EMPFAENGER_SATZ} ${ANTWORT_SATZ_HTML}`,
    origin: fakten.origin,
  });
}

function renderText(fakten: Fakten): string {
  const oben = [
    `${BRAND_NAME}: ${UEBERSCHRIFT}`,
    "",
    eintragSatz(fakten, false),
    "Bitte bestätige, dass das stimmt: Erst danach erhältst Du über die Anmeldung auf der Website Zugang zu Deinem Team.",
    "",
    SEITE_SATZ,
    `Der Link ist bis zum ${fakten.frist} gültig und funktioniert nur einmal.`,
    "Ist er abgelaufen, schickt die Verwaltung Dir auf Wunsch einen neuen.",
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
  };

  return {
    subject: `Du bist als ${fakten.rollen} für ${fakten.schule} eingetragen`,
    html: renderHtml(fakten),
    text: renderText(fakten),
  };
}
