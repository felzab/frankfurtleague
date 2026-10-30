import "server-only";

import { BRAND_NAME, mailOrigin } from "./emailShell";
import { formatDatum } from "./format";
import { kontaktBestaetigungsLink } from "./kontaktLink";
import { DEIN_BEREICH_TITEL } from "./seitenNamen";
import { rollenText } from "./teamVokabular";

import type { Absatz, Mail, Satz } from "./emailShell";
import type { CalendarDay } from "./format";
import type { FLKontaktLinkDaten, FLKontaktZeile } from "./generated/client/types";
import type { MailLink } from "./mailKinds";

/** Why a closed row's page offers no confirmation, in the page's own terms. */
const GESCHLOSSEN_SATZ: Record<Exclude<FLKontaktZeile, "offen">, string> = {
  saison_vorbei: "Die Saison ist vorbei, deshalb kannst Du den Eintrag nicht bestätigen.",
  ausgetreten: "Das Team spielt in dieser Saison nicht mehr mit, deshalb kannst Du den Eintrag nicht bestätigen.",
};

/**
 * What the page takes and how long the link holds. No re-send on a closed row: the backend refuses
 * one there (`kontakt_zeile_ohne_saison`), so the message promises none.
 */
function linkAbsatz(zeile: FLKontaktZeile, frist: string): Absatz {
  const gueltig: Satz = ["Der Link ist bis zum ", { strong: frist }, " gültig und funktioniert nur einmal."];

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

// No name: the administrator typed this address and nobody has confirmed it, so behind a typo its reader is a
// stranger, owed none. One person a mail: an address is one person, so `rollen` are the seats that one holds.
/**
 * What one person an administrator seated on a team's season row is asked to confirm, from the facts the Postausgang
 * row holds and the link its hand-out minted. `token` is a bearer credential and is never taken apart here.
 */
export function buildKontaktBestaetigungEmail(
  { rollen, schule, saison_id: saisonId, frist, zeile }: FLKontaktLinkDaten,
  { origin, token }: MailLink,
): Mail {
  const site = mailOrigin(origin);
  const sitze = rollenText(rollen);

  return {
    art: "erstkontakt",
    subjectLine: `Du bist als ${sitze} für ${schule} eingetragen`,
    origin: site,
    vorname: "",
    absaetze: [
      [
        // „für {Team} in der Saison …“, as the registration messages name a team and its season.
        ["Die Verwaltung der ", BRAND_NAME, ` hat Dich in der Saison ${saisonId} als ${sitze} für `, { strong: schule }, " eingetragen."],
        zeile === "offen"
          ? [
              { strong: "Bitte bestätige, dass das stimmt" },
              // The signed-in area by its name on screen, and never „Zugang“: on screen that word names an
              // administrator's grant alone (`docs/glossary.md`), which a confirmed seat is not.
              `: Erst danach findest Du Dein Team nach der Anmeldung auf der Website unter „${DEIN_BEREICH_TITEL}“.`,
            ]
          : GESCHLOSSEN_SATZ[zeile],
      ],
      linkAbsatz(zeile, formatDatum(frist as CalendarDay)),
    ],
    // Named for what the page offers: a closed row's page has nothing to confirm.
    aktion: { label: zeile === "offen" ? "Eintrag bestätigen" : "Zum Eintrag", href: kontaktBestaetigungsLink(site, token) },
  };
}
