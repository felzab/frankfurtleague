import { laufendeFassung } from "@/test-support/einwilligungRegistry.ts";

import { gekeyteFassung, KONTAKT_ABSATZ_SCHLUESSEL, KONTAKT_BEDIEN_SCHLUESSEL } from "@/core/einwilligungSeiten.ts";

/** What the admin application page hands its reseat: the form's running label and the administration's contact page's running words. */
export const laufendeNeubesetzung = () => ({
  textVersion: laufendeFassung("bewerbung").text_version,
  absaetze: gekeyteFassung(laufendeFassung("bestaetigung_kontakt_verwaltung"), KONTAKT_ABSATZ_SCHLUESSEL, KONTAKT_BEDIEN_SCHLUESSEL).absaetze,
});
