import "server-only";

import { BRAND_NAME, mailOrigin } from "./emailShell";
import { kontaktBestaetigungsLink } from "./kontaktLink";
import { DEIN_BEREICH_TITEL } from "./seitenNamen";

import type { Absatz, Mail, Satz } from "./emailShell";

/**
 * The season row's state at the mint. Once the season is over or the team has left it, the link's
 * page takes the Widerspruch alone, so the message asks for no confirmation.
 */
export type KontaktZeile = "offen" | "saison_vorbei" | "ausgetreten";

/**
 * What one person an administrator seated on a team's season row is asked to confirm. No name: the
 * administrator typed this address and nobody has confirmed it, so behind a typo its reader is a
 * stranger, owed none.
 */
export interface KontaktBestaetigungData {
  /** The serving origin, never `fl_frontend/src/core/brand.ts :: SITE_URL`. */
  origin: string;
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

/** Why a closed row's page offers no confirmation, in the page's own terms. */
const GESCHLOSSEN_SATZ: Record<Exclude<KontaktZeile, "offen">, string> = {
  saison_vorbei: "Die Saison ist vorbei, deshalb kannst Du den Eintrag nicht bestätigen.",
  ausgetreten: "Das Team spielt in dieser Saison nicht mehr mit, deshalb kannst Du den Eintrag nicht bestätigen.",
};

/**
 * What the page takes and how long the link holds. No re-send on a closed row: the backend refuses
 * one there (`REQ-KONTAKT-005`), so the message promises none.
 */
function linkAbsatz(zeile: KontaktZeile, frist: string): Absatz {
  const gueltig: Satz = ["Der Link ist bis zum ", { stark: frist }, " gültig und funktioniert nur einmal."];

  return zeile === "offen"
    ? [
        // Both answers are named before the press: a reader who came to object and meets a birthdate box was
        // asked something the message did not say.
        "Auf der Seite bestätigst Du den Eintrag mit Deinem Geburtsdatum, oder Du widersprichst ihm, dann entfernen wir Deine Angaben daraus.",
        gueltig,
        "Ist er abgelaufen, schickt die Verwaltung Dir auf Wunsch einen neuen.",
      ]
    : [
        // The one answer such a page takes, worded as the page words it.
        "Möchtest Du nicht eingetragen bleiben, kannst Du über den Link widersprechen.",
        "Dann entfernen wir Deine Angaben aus dem Eintrag.",
        gueltig,
      ];
}

export function buildKontaktBestaetigungEmail({
  origin,
  rollenText,
  schule,
  saisonId,
  token,
  fristText,
  zeile,
}: KontaktBestaetigungData): Mail {
  const site = mailOrigin(origin);

  return {
    art: "erstkontakt",
    betreff: `Du bist als ${rollenText} für ${schule} eingetragen`,
    origin: site,
    vorname: "",
    absaetze: [
      [
        // „für {Team} in der Saison …“, as the registration messages name a team and its season.
        ["Die Verwaltung der ", BRAND_NAME, ` hat Dich in der Saison ${saisonId} als ${rollenText} für `, { stark: schule }, " eingetragen."],
        zeile === "offen"
          ? [
              { stark: "Bitte bestätige, dass das stimmt" },
              // The signed-in area by its name on screen, and never „Zugang“: on screen that word names an
              // administrator's grant alone (`docs/glossary.md`), which a confirmed seat is not.
              `: Erst danach findest Du Dein Team nach der Anmeldung auf der Website unter „${DEIN_BEREICH_TITEL}“.`,
            ]
          : GESCHLOSSEN_SATZ[zeile],
      ],
      linkAbsatz(zeile, fristText),
    ],
    // Named for what the page offers: a closed row's page has nothing to confirm.
    aktion: { label: zeile === "offen" ? "Eintrag bestätigen" : "Zum Eintrag", href: kontaktBestaetigungsLink(site, token) },
  };
}
