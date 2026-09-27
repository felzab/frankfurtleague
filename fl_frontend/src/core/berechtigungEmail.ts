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

export type BerechtigungEmail = { subject: string; html: string; text: string };

/** The zone a reader checks the stamp against, never the image's UTC. */
const ZEITZONE = "Europe/Berlin";

const BETREFF = `Änderung beim Zugang zur Verwaltung der ${BRAND_NAME}`;
const UEBERSCHRIFT = "Änderung beim Zugang zur Verwaltung";
const ZIEL_LABEL = "Zur Verwaltung";

// eslint-disable-next-line local/admin-link -- a mailed link names no season; the page lists every grant whatever the season
const ZIEL_PFAD = "/bereich/admin/administratoren";

/** A change made outside the application names nobody, and says where it was made instead. */
const OHNE_VERWALTUNG = "Diese Änderung wurde nicht in der Verwaltung vorgenommen, sondern direkt in der Datenbank.";

/** What a reader does with the notice, and the whole of why every holder is sent it. */
const WARNSATZ = "Wenn Du diese Änderung nicht erwartet hast, melde Dich sofort bei den anderen Administratorinnen und Administratoren.";

/** One change as the notice states it; `adresse` null is a barred address, which the notice never names. */
export type Zugangsaenderung =
  | { readonly art: "erteilt" | "entzogen"; readonly adresse: string | null }
  | { readonly art: "geaendert"; readonly adresse: string | null; readonly inhaber: boolean };

/** Who made the change and when, or `null` where it was made in the database directly. */
export type Urheber = { readonly von: string; readonly am: string } | null;

function zeitText(instant: string): string {
  return new Date(instant).toLocaleString("de-DE", { timeZone: ZEITZONE, dateStyle: "long", timeStyle: "short" });
}

/** The change's sentence, the address marked up by `wer` so the two parts each take their own form. */
function aenderungsSatz(aenderung: Zugangsaenderung, wer: (adresse: string) => string): string {
  const { adresse } = aenderung;

  switch (aenderung.art) {
    case "erteilt":
      return adresse === null ? "Eine gesperrte Adresse hat jetzt Zugang zur Verwaltung." : `${wer(adresse)} hat jetzt Zugang zur Verwaltung.`;
    case "entzogen":
      return adresse === null
        ? "Eine gesperrte Adresse hat keinen Zugang zur Verwaltung mehr."
        : `${wer(adresse)} hat keinen Zugang zur Verwaltung mehr.`;
    case "geaendert": {
      const subjekt = adresse === null ? "Eine gesperrte Adresse" : wer(adresse);
      return aenderung.inhaber
        ? `${subjekt} ist jetzt Inhaber der Verwaltung.`
        : `${subjekt} ist nicht mehr Inhaber der Verwaltung und behält den Zugang.`;
    }
  }
}

/** The second sentence: who made it and when, or where a change nobody in the application made came from. */
function urheberSatz(urheber: Urheber, wer: (adresse: string) => string): string {
  return urheber === null ? OHNE_VERWALTUNG : `Geändert von ${wer(urheber.von)} am ${wer(zeitText(urheber.am))}.`;
}

/**
 * **The body depends on the change alone**, never on when it is sent or to whom: a repeat under one key
 * must compose the same message for the provider to collapse it (`docs/frontend/spec.md :: I457`).
 */
export function buildBerechtigungEmail(aenderung: Zugangsaenderung, urheber: Urheber, rawOrigin: string): BerechtigungEmail {
  const origin = mailOrigin(rawOrigin);
  const ziel = `${origin}${ZIEL_PFAD}`;

  const html = renderKarte({
    titel: `${BRAND_NAME}: ${UEBERSCHRIFT}`,
    ueberschrift: escapeHtml(UEBERSCHRIFT),
    bloecke: [
      paragraph(aenderungsSatz(aenderung, (value) => strong(escapeHtml(value)))),
      paragraph(escapeHtml(urheberSatz(urheber, (value) => value))),
      paragraph(escapeHtml(WARNSATZ), "0", ASIDE_TEXT),
    ],
    aktionen: [{ href: ziel, label: ZIEL_LABEL, ton: "primary" }],
    fuss: ANTWORT_SATZ_HTML,
    origin: origin,
  });

  const oben = [
    `${BRAND_NAME}: ${UEBERSCHRIFT}`,
    "",
    aenderungsSatz(aenderung, (value) => value),
    "",
    urheberSatz(urheber, (value) => value),
    "",
    `${ZIEL_LABEL}: ${ziel}`,
    "",
    WARNSATZ,
  ];
  const text = [stuffSignatureDelimiter(oben.join("\n")), ...textFooter(origin, [ANTWORT_SATZ_TEXT])].join("\n");

  return { subject: BETREFF, html: html, text: text };
}
