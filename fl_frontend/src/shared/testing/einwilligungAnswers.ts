import { publishedLaufendeFassung } from "@/core/einwilligungDocument.ts";
import {
  gekeyteFassung,
  KONTAKT_ABSATZ_SCHLUESSEL,
  KONTAKT_BEDIEN_SCHLUESSEL,
  SCHIEDSRICHTER_ABSATZ_SCHLUESSEL,
  SPIELER_ABSATZ_SCHLUESSEL,
  SPIELER_WIEDERKEHREND_ABSATZ_SCHLUESSEL,
} from "@/core/einwilligungSeiten.ts";

/** The words each keyed page runs, keyed as its page reads them, for a view rendered without its page. */
export const laufendeKontaktFassung = () =>
  gekeyteFassung(publishedLaufendeFassung("bestaetigung_kontakt"), KONTAKT_ABSATZ_SCHLUESSEL, KONTAKT_BEDIEN_SCHLUESSEL);

/** Each tagged with its page, as the pupil's confirmation page hands the words of the one a link opens. */
export const laufendeSpielerFassung = () => ({
  ...gekeyteFassung(publishedLaufendeFassung("bestaetigung_spieler"), SPIELER_ABSATZ_SCHLUESSEL, ["kader_oeffentlich", "intern"] as const),
  seite: "bestaetigung_spieler" as const,
});

export const laufendeSpielerWiederkehrendFassung = () => ({
  ...gekeyteFassung(publishedLaufendeFassung("bestaetigung_spieler_wiederkehrend"), SPIELER_WIEDERKEHREND_ABSATZ_SCHLUESSEL, [
    "kader_oeffentlich",
    "intern",
  ] as const),
  seite: "bestaetigung_spieler_wiederkehrend" as const,
});

export const laufendeSchiedsrichterFassung = () =>
  gekeyteFassung(publishedLaufendeFassung("bestaetigung_schiedsrichter"), SCHIEDSRICHTER_ABSATZ_SCHLUESSEL, [
    "kader_oeffentlich",
    "intern",
  ] as const);

/** The administration's contact page, which a person an administrator seated opens on. */
export const laufendeKontaktVerwaltungFassung = () =>
  gekeyteFassung(publishedLaufendeFassung("bestaetigung_kontakt_verwaltung"), KONTAKT_ABSATZ_SCHLUESSEL, KONTAKT_BEDIEN_SCHLUESSEL);

/** The season row's contact page, which a person seated on a team's season row by the administration opens on. */
export const laufendeKontaktSaisonFassung = () =>
  gekeyteFassung(publishedLaufendeFassung("bestaetigung_kontakt_saison"), KONTAKT_ABSATZ_SCHLUESSEL, KONTAKT_BEDIEN_SCHLUESSEL);

/** What the admin application page hands its reseat: the form's running label and the administration's contact page's running words. */
export const laufendeNeubesetzung = () => ({
  textVersion: publishedLaufendeFassung("bewerbung").text_version,
  absaetze: laufendeKontaktVerwaltungFassung().absaetze,
});

/** The application form's running words, as its page hands them to the form. */
export function laufendeBewerbungFassung(): { textVersion: string; absaetze: readonly string[]; schalter: string } {
  const fassung = publishedLaufendeFassung("bewerbung");
  return { textVersion: fassung.text_version, absaetze: fassung.absaetze, schalter: fassung.schalter };
}
