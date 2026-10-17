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
import { ERASED_ACTOR_MARKER } from "./erasedActor";

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

/** Why a grant's address is withheld, the notice naming neither a barred address nor an erased person's. */
export type Vorenthalten = { readonly vorenthalten: "gesperrt" | "geloescht" };

/** One change as the notice states it. */
export type Zugangsaenderung = {
  readonly art: "erteilt" | "geaendert" | "entzogen";
  readonly adresse: string | Vorenthalten;
  // The `owner` tier the grant holds now, or held until it ended.
  readonly inhaber: boolean;
};

/**
 * Who made the change and when, or `null` where it was made in the database directly. `von` is null for an
 * administrator since barred, and `ERASED_ACTOR_MARKER` for one erased since, neither of whom the notice names.
 */
export type Urheber = { readonly von: string | null; readonly am: string | null } | null;

/** A withheld grant address, in the subject's place. An erased person's is named by nothing, not even that state. */
const OHNE_ADRESSE: Readonly<Record<Vorenthalten["vorenthalten"], string>> = {
  gesperrt: "Eine gesperrte Adresse",
  geloescht: "Eine nicht genannte Adresse",
};

/** The `owner` tier as a person of either gender holds it, never the masculine word for both. */
const INHABER = "Inhaberin oder Inhaber";

/** The acting administrator where a ban withholds them. */
const GESPERRTER_URHEBER = "einer gesperrten Adresse";

/** The acting administrator where they have been erased since. */
const UNGENANNTER_URHEBER = "einer nicht genannten Adresse";

function zeitText(instant: string): string {
  return new Date(instant).toLocaleString("de-DE", { timeZone: ZEITZONE, dateStyle: "long", timeStyle: "short" });
}

/** The change's sentence, the address marked up by `wer` so the two parts each take their own form. */
function aenderungsSatz(aenderung: Zugangsaenderung, wer: (adresse: string) => string): string {
  const { adresse } = aenderung;
  const subjekt = typeof adresse === "string" ? wer(adresse) : OHNE_ADRESSE[adresse.vorenthalten];

  switch (aenderung.art) {
    case "erteilt": {
      // An `owner` grant says so: the application grants none, so one is always a change made in the database.
      const zugang = aenderung.inhaber ? `hat jetzt Zugang zur Verwaltung als ${INHABER}.` : "hat jetzt Zugang zur Verwaltung.";
      return `${subjekt} ${zugang}`;
    }
    case "entzogen":
      // An `owner` grant's end says so: an erasure ends one with no demotion before it, and the last owner's
      // end is the one a holder most needs told.
      return aenderung.inhaber
        ? `${subjekt} ist nicht mehr ${INHABER} der Verwaltung und hat keinen Zugang mehr.`
        : `${subjekt} hat keinen Zugang zur Verwaltung mehr.`;
    case "geaendert":
      return aenderung.inhaber
        ? `${subjekt} ist jetzt ${INHABER} der Verwaltung.`
        : `${subjekt} ist nicht mehr ${INHABER} der Verwaltung und behält den Zugang.`;
  }
}

/** The acting administrator in the notice's words, never a barred address or the erasure's marker. */
function urheberName(von: string | null, wer: (adresse: string) => string): string {
  if (von === null) return GESPERRTER_URHEBER;

  return von === ERASED_ACTOR_MARKER ? UNGENANNTER_URHEBER : wer(von);
}

/** The second sentence: who made it and when, or where a change nobody in the application made came from. */
function urheberSatz(urheber: Urheber, wer: (adresse: string) => string): string {
  if (urheber === null) return OHNE_VERWALTUNG;

  const von = urheberName(urheber.von, wer);
  return urheber.am === null ? `Geändert von ${von}.` : `Geändert von ${von} am ${wer(zeitText(urheber.am))}.`;
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
