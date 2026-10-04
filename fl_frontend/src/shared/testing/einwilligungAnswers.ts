import { publishedLaufendeFassung } from "@/core/einwilligungDocument.ts";
import {
  gekeyteFassung,
  KONTAKT_ABSATZ_SCHLUESSEL,
  KONTAKT_BEDIEN_SCHLUESSEL,
  SCHIEDSRICHTER_ABSATZ_SCHLUESSEL,
  SPIELER_ABSATZ_SCHLUESSEL,
} from "@/core/einwilligungSeiten.ts";

/** The words each keyed page runs, keyed as its page reads them, for a view rendered without its page. */
export const laufendeKontaktFassung = () =>
  gekeyteFassung(publishedLaufendeFassung("bestaetigung_kontakt"), KONTAKT_ABSATZ_SCHLUESSEL, KONTAKT_BEDIEN_SCHLUESSEL);

export const laufendeSpielerFassung = () =>
  gekeyteFassung(publishedLaufendeFassung("bestaetigung_spieler"), SPIELER_ABSATZ_SCHLUESSEL, ["kader_oeffentlich", "intern"] as const);

export const laufendeSchiedsrichterFassung = () =>
  gekeyteFassung(publishedLaufendeFassung("bestaetigung_schiedsrichter"), SCHIEDSRICHTER_ABSATZ_SCHLUESSEL, [
    "kader_oeffentlich",
    "intern",
  ] as const);

/** What the admin application page hands its reseat: the form's running label and the contact page's running words. */
export const laufendeNeubesetzung = () => ({
  textVersion: publishedLaufendeFassung("bewerbung").text_version,
  absaetze: laufendeKontaktFassung().absaetze,
});

/** The application form's running words, as its page hands them to the form. */
export function laufendeBewerbungFassung(): { textVersion: string; absaetze: readonly string[]; schalter: string } {
  const fassung = publishedLaufendeFassung("bewerbung");
  return { textVersion: fassung.text_version, absaetze: fassung.absaetze, schalter: fassung.schalter };
}
