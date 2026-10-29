import "server-only";

import { BRAND_NAME, mailOrigin } from "./emailShell";

import type { Mail } from "./emailShell";

const SPIELER_BESTAETIGUNG_PATH = "/bestaetigung/spieler";

// Beside the builders that spend it rather than in the slice: `core` may not import a feature.

/**
 * The one place a pupil's confirmation link is spelled.
 *
 * `token` is the parameter name because `nginx/shared/http.conf :: $credential_free_uri` matches that name;
 * a second spelling reaches the access line and the referer unredacted.
 */
function spielerBestaetigungsLink(origin: string, token: string): string {
  return `${origin}${SPIELER_BESTAETIGUNG_PATH}?token=${encodeURIComponent(token)}`;
}

/**
 * What the two link messages are addressed with. No name, unlike the decline, which reaches a confirmed
 * address alone: this one has proved nothing, and after a typo its stranger is owed no pupil's name.
 */
export interface RegistrierungLinkEmailData {
  readonly teamName: string;
  readonly saisonId: string;
  /** The serving origin, RAW: the builder normalises it once. */
  readonly origin: string;
  /** A bearer credential, spelled into the link here and never taken apart. */
  readonly token: string;
  // Handed in rather than read here: `fl_frontend/eslint.config.mjs :: LAYER_BOUNDARY` keeps `core`
  // out of a feature slice, and the mirrored constant lives in one.
  readonly fristTage: number;
}

/**
 * Why a team declined, as the decline stores it: the backend's fixed choice, never free text. Spelled
 * here because `core` may not import the slice's mirror, which is passed in and so checked against this.
 */
type RegistrierungAbsageGrund = "andere_person" | null;

/** What the decline note is addressed with. It carries no confirmation link, only the league's landing: the decision is the team's and stands. */
export interface RegistrierungAbsageEmailData {
  readonly vorname: string;
  readonly teamName: string;
  readonly saisonId: string;
  readonly origin: string;
  readonly grund: RegistrierungAbsageGrund;
}

/**
 * The link a submission mints, named for the deadline the sweep deletes on.
 *
 * **The number is the mirrored constant's, never a word here**: the mail and the page would
 * otherwise state two deadlines, and one would not move.
 */
export function buildRegistrierungBestaetigungEmail({ teamName, saisonId, origin, token, fristTage }: RegistrierungLinkEmailData): Mail {
  // Through `mailOrigin` once, and the link minted on what it answered: a raw `AUTH_URL` with a
  // trailing slash would otherwise put `//bestaetigung/spieler` in every registering pupil's mail,
  // which the edge's noindex prefix does not match.
  const site = mailOrigin(origin);

  return {
    art: "erstkontakt",
    // The team is in the subject because a pupil registering for two of them gets two of these, and
    // the season alone does not tell one from the other in an inbox.
    betreff: `Registrierung für ${teamName} bestätigen`,
    origin: site,
    vorname: "",
    absaetze: [
      [["Du hast Dich für ", { stark: teamName }, ` in der Saison ${saisonId} der ${BRAND_NAME} registriert.`]],
      [
        "Über den Button unten bestätigst Du die Registrierung, trägst Dein Geburtsdatum ein und entscheidest, was mit Deinen Angaben passieren darf.",
        "Erst danach kann Dein Team Dich in den Kader aufnehmen.",
      ],
      [
        `Bestätigst Du nicht innerhalb von ${String(fristTage)} Tagen, löschen wir die Registrierung mit allen Angaben.`,
        "Du kannst Dich dann über den Link Deines Teams neu registrieren.",
      ],
    ],
    aktion: { label: "Registrierung bestätigen", href: spielerBestaetigungsLink(site, token) },
  };
}

/**
 * The sweep's one reminder.
 *
 * It says that the deadline has not moved, because a reminder that merely repeats the request reads
 * as a fresh clock — and the row is erased on the day the first message named.
 */
export function buildRegistrierungErinnerungEmail({ teamName, saisonId, origin, token, fristTage }: RegistrierungLinkEmailData): Mail {
  const site = mailOrigin(origin);

  return {
    art: "erstkontakt",
    betreff: `Erinnerung: Registrierung für ${teamName} bestätigen`,
    origin: site,
    vorname: "",
    absaetze: [
      [["Deine Registrierung für ", { stark: teamName }, ` in der Saison ${saisonId} der ${BRAND_NAME} ist noch nicht bestätigt.`]],
      [
        `Die Frist von ${String(fristTage)} Tagen läuft weiter.`,
        "Diese Erinnerung verschiebt sie nicht.",
        "Bestätigst Du bis dahin nicht, löschen wir die Registrierung mit allen Angaben.",
      ],
      ["Der Link aus der ersten E-Mail funktioniert weiterhin.", "Dieser hier funktioniert genauso."],
    ],
    aktion: { label: "Registrierung bestätigen", href: spielerBestaetigungsLink(site, token) },
  };
}

/**
 * The pupil's next step after a decline, by its reason: a team saying the address is somebody else's
 * refused the address rather than the pupil, so that note sends them back with one of their own.
 */
const ABSAGE_WEITER: Readonly<Record<NonNullable<RegistrierungAbsageGrund> | "keiner", readonly [string, ...string[]]>> = {
  andere_person: [
    "Unter dieser E-Mail-Adresse ist schon eine andere Person eingetragen.",
    "Registriere Dich bitte erneut über den Link Deines Teams, mit Deiner eigenen E-Mail-Adresse.",
  ],
  keiner: ["Hast Du Fragen zu dieser Entscheidung, sprich bitte mit Deinem Team."],
};

/**
 * The one note after a team declines a registration.
 *
 * **It names no other person**: the reason it states is the stored choice, so whoever holds the
 * mailbox learns that an address is taken and never by whom.
 */
export function buildRegistrierungAbsageEmail({ vorname, teamName, saisonId, origin, grund }: RegistrierungAbsageEmailData): Mail {
  const site = mailOrigin(origin);

  return {
    art: "mitteilung",
    betreff: `Deine Registrierung für ${teamName}`,
    origin: site,
    vorname: vorname,
    absaetze: [
      [[{ stark: teamName }, ` hat Deine Registrierung für die Saison ${saisonId} der ${BRAND_NAME} abgelehnt.`]],
      ABSAGE_WEITER[grund ?? "keiner"],
      ["Deine Angaben aus der Registrierung löschen wir einen Monat nach dieser Entscheidung."],
    ],
    // The league's landing: no record is left to press on.
    aktion: { label: `Zur ${BRAND_NAME}`, href: site },
  };
}
