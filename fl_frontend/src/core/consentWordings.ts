import { ROUTES } from "./routes";

import type { Route } from "next";
import type { FLEinwilligungUmfang } from "./generated/client/types";

/** The line under a control: its words, a link among them where it points to a page. */
type ConsentLine = ReadonlyArray<string | { readonly href: Route; readonly label: string }>;

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
      "Dafür erhält WhatsApp deine Telefonnummer und unsere Nachrichten. Du kannst das jederzeit in deinem Konto widerrufen. Mehr unter ",
      { href: PRIVACY_NOTICE, label: "Datenschutz" },
      ".",
    ],
  },
  "2026-11-medien-1": {
    label: "Die Liga darf Fotos, Videos und Interviews von mir auf ihrer Website und auf Instagram veröffentlichen.",
    line: ["Du kannst das jederzeit in deinem Konto widerrufen. Mehr unter ", { href: PRIVACY_NOTICE, label: "Datenschutz" }, "."],
  },
  "2026-11-name-kader-1": {
    question: "Was darf von deinem Namen auf der Website stehen?",
    options: {
      kader_oeffentlich: "Vorname und Anfangsbuchstabe des Nachnamens",
      intern: "Kein Name, nur Nummer und Position",
    },
    line: [
      "Ohne Namen steht dort „anonym“. Du kannst das jederzeit in deinem Konto ändern. Mehr unter ",
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
      "Ohne Namen steht dort „anonym“. Du kannst das jederzeit in deinem Konto ändern. Mehr unter ",
      { href: PRIVACY_NOTICE, label: "Datenschutz" },
      ".",
    ],
  },
} as const satisfies Readonly<Record<string, SwitchWording | ScopeWording>>;
