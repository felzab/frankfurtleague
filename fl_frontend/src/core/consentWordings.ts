import { ROUTES } from "./routes";

import type { Route } from "next";
import type {
  FLEinwilligungTextVersion,
  FLEinwilligungUmfang,
  FLSchiedsrichterTextVersions,
  FLSeatTextVersions,
  FLSpielerTextVersions,
} from "./generated/client/types";

/** The line under a control: its words, a link among them where it points to a page. */
export type ConsentLine = ReadonlyArray<string | { readonly href: Route; readonly label: string }>;

/** A consent given by one switch: the switch's own sentence, its whole label, and the line under it. */
type SwitchWording = { readonly label: string; readonly line: ConsentLine };

/** A consent given by picking one of the scopes `umfang` stores: the question, each option by the value it writes, and the line. */
type ScopeWording = { readonly question: string; readonly options: Readonly<Record<FLEinwilligungUmfang, string>>; readonly line: ConsentLine };

const PRIVACY_NOTICE = ROUTES.privacyNotice.path();

/**
 * Every consent wording a stored record can name, keyed by the label its evidence stamps as `text_version`. A record
 * proves what its person was shown only while its label's words stay as they were, so different words are a new label
 * beside the old, never an edit of one; `consentWordings.test.ts` fails an entry reworded in place. Each entry spells
 * its words out whole, a line two entries share included, so no edit to one reaches another.
 *
 * Outside `COPY` and `SERVER_COPY`, whose entries the copy standard rewords freely. A label's month is the month its
 * words go live, which the deploy first serving them sets.
 */
export const CONSENT_WORDINGS = {
  "2026-11-whatsapp-1": {
    label: "Die Liga darf mich auch über WhatsApp erreichen.",
    line: [
      "Dafür erhält WhatsApp deine Telefonnummer und unsere Nachrichten. Du kannst das jederzeit in deinem Konto oder per E-Mail an kontakt@frankfurtleague.de widerrufen. Mehr unter ",
      { href: PRIVACY_NOTICE, label: "Datenschutz" },
      ".",
    ],
  },
  "2026-11-medien-1": {
    label: "Die Liga darf Fotos, Videos und Interviews von mir auf ihrer Website und auf Instagram veröffentlichen.",
    line: [
      "Du kannst das jederzeit in deinem Konto oder per E-Mail an kontakt@frankfurtleague.de widerrufen. Mehr unter ",
      { href: PRIVACY_NOTICE, label: "Datenschutz" },
      ".",
    ],
  },
  "2026-11-name-kader-1": {
    question: "Was darf von deinem Namen auf der Website stehen?",
    options: {
      kader_oeffentlich: "Vorname und Anfangsbuchstabe des Nachnamens",
      intern: "Kein Name, nur Nummer und Position",
    },
    line: [
      "Ohne Namen steht dort „anonym“. Du kannst das jederzeit in deinem Konto oder per E-Mail an kontakt@frankfurtleague.de ändern. Mehr unter ",
      { href: PRIVACY_NOTICE, label: "Datenschutz" },
      ".",
    ],
  },
  "2026-11-name-spielplan-1": {
    question: "Was darf von deinem Namen im Spielplan stehen?",
    options: {
      kader_oeffentlich: "Erster Teil des Namens und Anfangsbuchstabe des nächsten",
      intern: "Kein Name",
    },
    line: [
      "Ohne Namen steht dort „anonym“. Du kannst das jederzeit in deinem Konto oder per E-Mail an kontakt@frankfurtleague.de ändern. Mehr unter ",
      { href: PRIVACY_NOTICE, label: "Datenschutz" },
      ".",
    ],
  },
  // Every label the backend's `Literal`s admit, and no other: a label the backend accepts without words here, or words
  // under a label it refuses, fails the type check.
} as const satisfies Readonly<Record<FLEinwilligungTextVersion, SwitchWording | ScopeWording>>;

// The labels each kind of record's press names, one per choice, as its request schema admits them.
export const SEAT_TEXT_VERSIONS = { umfang: "2026-11-whatsapp-1", medien: "2026-11-medien-1" } as const satisfies FLSeatTextVersions;
export const SPIELER_TEXT_VERSIONS = { umfang: "2026-11-name-kader-1", medien: "2026-11-medien-1" } as const satisfies FLSpielerTextVersions;
export const SCHIEDSRICHTER_TEXT_VERSIONS = {
  umfang: "2026-11-name-spielplan-1",
  medien: "2026-11-medien-1",
} as const satisfies FLSchiedsrichterTextVersions;

/** The words a kind's page shows beside its two choices, read off its labels so a page shows what its press stamps. */
export const SEAT_WORDINGS = { umfang: CONSENT_WORDINGS[SEAT_TEXT_VERSIONS.umfang], medien: CONSENT_WORDINGS[SEAT_TEXT_VERSIONS.medien] };
export const SPIELER_WORDINGS = {
  umfang: CONSENT_WORDINGS[SPIELER_TEXT_VERSIONS.umfang],
  medien: CONSENT_WORDINGS[SPIELER_TEXT_VERSIONS.medien],
};
export const SCHIEDSRICHTER_WORDINGS = {
  umfang: CONSENT_WORDINGS[SCHIEDSRICHTER_TEXT_VERSIONS.umfang],
  medien: CONSENT_WORDINGS[SCHIEDSRICHTER_TEXT_VERSIONS.medien],
};
