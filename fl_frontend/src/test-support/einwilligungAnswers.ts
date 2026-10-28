import { publishedLaufendeFassung } from "@/test-support/einwilligungDocument.ts";

import { gekeyteFassung, KONTAKT_ABSATZ_SCHLUESSEL, KONTAKT_BEDIEN_SCHLUESSEL } from "@/core/einwilligungSeiten.ts";

/** What the admin application page hands its reseat: the form's running label and the administration's contact page's running words. */
export const laufendeNeubesetzung = () => ({
  textVersion: publishedLaufendeFassung("bewerbung").text_version,
  absaetze: gekeyteFassung(publishedLaufendeFassung("bestaetigung_kontakt_verwaltung"), KONTAKT_ABSATZ_SCHLUESSEL, KONTAKT_BEDIEN_SCHLUESSEL)
    .absaetze,
});
