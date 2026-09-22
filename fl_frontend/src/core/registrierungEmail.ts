import "server-only";

import { KONTAKT_EMAIL } from "./brand";
import {
  ANTWORT_SATZ_HTML,
  ANTWORT_SATZ_TEXT,
  ASIDE_TEXT,
  BRAND_NAME,
  brandPhrase,
  escapeHtml,
  link,
  mailOrigin,
  paragraph,
  renderKarte,
  strong,
  stuffSignatureDelimiter,
  textFooter,
} from "./emailShell";

import type { Aktion } from "./emailShell";

const FALLBACK_SATZ = "Falls der Button nicht funktioniert, kopiere diese Adresse in Deinen Browser:";

export const SPIELER_BESTAETIGUNG_PATH = "/bestaetigung/spieler";

// Beside the builders that spend it rather than in the slice: `core` may not import a feature, and
// minting inside them is what puts a normalised origin under `emailShell.test.ts`'s sweep.

/**
 * The one place a pupil's confirmation link is spelled.
 *
 * `token` is the parameter name because `nginx/prod.conf :: $credential_free_uri` matches that name;
 * a second spelling reaches the access line and the referer unredacted.
 */
export function spielerBestaetigungsLink(origin: string, token: string): string {
  return `${origin}${SPIELER_BESTAETIGUNG_PATH}?token=${encodeURIComponent(token)}`;
}

/** One message as this slice builds it, in the two parts every message here carries. */
export type RegistrierungEmail = { subject: string; html: string; text: string };

/** What the two link messages are addressed with. The surname never travels: a forwarded link learns no full name. */
export interface RegistrierungLinkEmailData {
  readonly vorname: string;
  readonly teamName: string;
  readonly saisonId: string;
  /** The serving origin (`docs/frontend/spec.md :: I186`), RAW: the builder normalises it once. */
  readonly origin: string;
  /** A bearer credential, spelled into the link here and never taken apart. */
  readonly token: string;
  // Handed in rather than read here: `fl_frontend/eslint.config.mjs :: LAYER_BOUNDARY` keeps `core`
  // out of a feature slice, and the mirrored constant lives in one.
  readonly fristTage: number;
}

/** What the season-end note is addressed with. It carries no link, the record it is about being gone. */
export interface RegistrierungNotizEmailData {
  readonly vorname: string;
  readonly teamName: string;
  readonly saisonId: string;
  readonly origin: string;
}

/**
 * One control, as the sign-in message carries one (`fl_frontend/src/core/authEmail.ts :: aktionen`):
 * the message exists for this link alone, and a second destination competes with the one press a
 * reader came for.
 */
function aktionen(url: string): readonly Aktion[] {
  return [{ href: url, label: "Registrierung bestätigen", ton: "primary" }];
}

/**
 * For the reader who registered for nothing: a pupil's address can be typed by whoever holds the
 * team's invite. What ignoring costs differs from the referee's — here the entry goes by itself.
 */
const ignorierSatz = (fristTage: number): string =>
  `Du weißt nichts von einer Registrierung bei der ${BRAND_NAME}? Dann ignoriere diese E-Mail einfach: Ohne Deine Bestätigung wird die Registrierung nach ${String(fristTage)} Tagen von selbst gelöscht. Soll sie sofort weg, schreib uns an ${KONTAKT_EMAIL}.`;

function linkBloecke(url: string, fristTage: number): readonly string[] {
  return [
    paragraph(FALLBACK_SATZ, "0 0 8px", ASIDE_TEXT),
    /* The link runs past the card's width, so this one paragraph breaks inside a word, as the
       sign-in message's does. Marked as a link as well: an address a reader has to select and paste
       is not a route. */
    paragraph(link(url, url), "0 0 16px", `${ASIDE_TEXT}word-break:break-all;`),
    paragraph(escapeHtml(ignorierSatz(fristTage)), "0", ASIDE_TEXT),
  ];
}

const bestaetigungSaetze = ({ vorname, teamName, saisonId, fristTage }: RegistrierungLinkEmailData): readonly string[] => [
  `Hallo ${vorname}, Du hast Dich für ${teamName} in der Saison ${saisonId} der ${BRAND_NAME} registriert.`,
  "Über den Button unten bestätigst Du die Registrierung, trägst Dein Geburtsdatum ein und entscheidest, was mit Deinen Angaben passieren darf. Erst danach kann Dein Team Dich in den Kader aufnehmen.",
  `Bestätigst Du nicht innerhalb von ${String(fristTage)} Tagen, löschen wir die Registrierung mit allen Angaben. Du kannst Dich dann über den Link Deines Teams neu registrieren.`,
];

/**
 * The link a submission mints, named for the deadline the sweep deletes on.
 *
 * **The number is the mirrored constant's, never a word here**: the mail and the page would
 * otherwise state two deadlines, and one would not move.
 */
export function buildRegistrierungBestaetigungEmail(data: RegistrierungLinkEmailData): RegistrierungEmail {
  // Through `mailOrigin` once, and the link minted on what it answered: a raw `AUTH_URL` with a
  // trailing slash would otherwise put `//bestaetigung/spieler` in every registering pupil's mail,
  // which the edge's noindex prefix does not match.
  const site = mailOrigin(data.origin);
  const url = spielerBestaetigungsLink(site, data.token);
  const [anrede, worum, frist] = bestaetigungSaetze(data);

  return {
    // The team is in the subject because a pupil registering for two of them gets two of these, and
    // the season alone does not tell one from the other in an inbox.
    subject: `Registrierung für ${data.teamName} bestätigen: ${BRAND_NAME}, Saison ${data.saisonId}`,
    html: renderKarte({
      titel: `${BRAND_NAME}: Registrierung für ${data.teamName} bestätigen`,
      ueberschrift: escapeHtml("Registrierung bestätigen"),
      bloecke: [
        paragraph(
          `Hallo ${strong(escapeHtml(data.vorname))}, Du hast Dich für ${strong(escapeHtml(data.teamName))} in der ${brandPhrase(`Saison ${escapeHtml(data.saisonId)}`)} der ${BRAND_NAME} registriert.`,
        ),
        paragraph(escapeHtml(worum ?? "")),
        paragraph(escapeHtml(frist ?? "")),
        ...linkBloecke(url, data.fristTage),
      ],
      aktionen: aktionen(url),
      fuss: ANTWORT_SATZ_HTML,
      origin: site,
    }),
    text: [
      stuffSignatureDelimiter(
        [
          `${BRAND_NAME}: Registrierung bestätigen`,
          "",
          anrede ?? "",
          "",
          worum ?? "",
          "",
          url,
          "",
          frist ?? "",
          "",
          ignorierSatz(data.fristTage),
        ].join("\n"),
      ),
      ...textFooter(site, [ANTWORT_SATZ_TEXT]),
    ].join("\n"),
  };
}

const erinnerungSaetze = ({ vorname, teamName, saisonId, fristTage }: RegistrierungLinkEmailData): readonly string[] => [
  `Hallo ${vorname}, Deine Registrierung für ${teamName} in der Saison ${saisonId} der ${BRAND_NAME} ist noch nicht bestätigt.`,
  `Die Frist von ${String(fristTage)} Tagen läuft weiter. Diese Erinnerung verschiebt sie nicht. Bestätigst Du bis dahin nicht, löschen wir die Registrierung mit allen Angaben.`,
  "Der Link aus der ersten E-Mail funktioniert weiterhin; dieser hier genauso.",
];

/**
 * The sweep's one reminder.
 *
 * It says that the deadline has not moved, because a reminder that merely repeats the request reads
 * as a fresh clock — and the row is erased on the day the first message named.
 */
export function buildRegistrierungErinnerungEmail(data: RegistrierungLinkEmailData): RegistrierungEmail {
  const site = mailOrigin(data.origin);
  const url = spielerBestaetigungsLink(site, data.token);
  const [anrede, frist, zweiLinks] = erinnerungSaetze(data);

  return {
    subject: `Erinnerung: Registrierung für ${data.teamName} bestätigen`,
    html: renderKarte({
      titel: `${BRAND_NAME}: Erinnerung an Deine Registrierung`,
      ueberschrift: escapeHtml("Erinnerung"),
      bloecke: [
        paragraph(
          `Hallo ${strong(escapeHtml(data.vorname))}, Deine Registrierung für ${strong(escapeHtml(data.teamName))} in der ${brandPhrase(`Saison ${escapeHtml(data.saisonId)}`)} der ${BRAND_NAME} ist noch nicht bestätigt.`,
        ),
        paragraph(escapeHtml(frist ?? "")),
        paragraph(escapeHtml(zweiLinks ?? ""), "0 0 16px", ASIDE_TEXT),
        ...linkBloecke(url, data.fristTage),
      ],
      aktionen: aktionen(url),
      fuss: ANTWORT_SATZ_HTML,
      origin: site,
    }),
    text: [
      stuffSignatureDelimiter(
        [`${BRAND_NAME}: Erinnerung`, "", anrede ?? "", "", frist ?? "", "", url, "", zweiLinks ?? "", "", ignorierSatz(data.fristTage)].join(
          "\n",
        ),
      ),
      ...textFooter(site, [ANTWORT_SATZ_TEXT]),
    ].join("\n"),
  };
}

const saisonendeSaetze = ({ vorname, teamName, saisonId }: RegistrierungNotizEmailData): readonly string[] => [
  `Hallo ${vorname}, die Saison ${saisonId} der ${BRAND_NAME} ist vorbei.`,
  `Über Deine Registrierung für ${teamName} wurde bis zum Saisonende nicht entschieden, deshalb haben wir sie mit allen Angaben gelöscht. Du musst nichts tun.`,
  "Zur nächsten Saison kannst Du Dich über den Link Deines Teams wieder registrieren.",
];

/**
 * The one note after a confirmed but undecided registration is erased.
 *
 * **After the fact and never before it**: a pre-notice would ask a reader to act on a deadline
 * they have no control over.
 */
export function buildRegistrierungSaisonendeEmail(data: RegistrierungNotizEmailData): RegistrierungEmail {
  const site = mailOrigin(data.origin);
  const [anrede, geloescht, naechste] = saisonendeSaetze(data);

  return {
    subject: `Deine Registrierung für ${data.teamName} wurde gelöscht`,
    html: renderKarte({
      titel: `${BRAND_NAME}: Registrierung gelöscht`,
      ueberschrift: escapeHtml("Registrierung gelöscht"),
      bloecke: [
        paragraph(
          `Hallo ${strong(escapeHtml(data.vorname))}, die ${brandPhrase(`Saison ${escapeHtml(data.saisonId)}`)} der ${BRAND_NAME} ist vorbei.`,
        ),
        paragraph(
          `Über Deine Registrierung für ${strong(escapeHtml(data.teamName))} wurde bis zum Saisonende nicht entschieden, deshalb haben wir sie mit allen Angaben gelöscht. Du musst nichts tun.`,
        ),
        paragraph(escapeHtml(naechste ?? ""), "0", ASIDE_TEXT),
      ],
      // The league's own landing, because this message names no record to press on: a control
      // pointing at a deleted row would answer its reader with a dead link.
      aktionen: [{ href: site, label: "Zur Frankfurt League", ton: "outline" }],
      fuss: ANTWORT_SATZ_HTML,
      origin: site,
    }),
    text: [
      stuffSignatureDelimiter([`${BRAND_NAME}: Registrierung gelöscht`, "", anrede ?? "", "", geloescht ?? "", "", naechste ?? ""].join("\n")),
      ...textFooter(site, [ANTWORT_SATZ_TEXT]),
    ].join("\n"),
  };
}
