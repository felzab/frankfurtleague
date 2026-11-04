import type { FLEinwilligungUmfang } from "./generated/client/types";

/** A consent given by one switch: the switch's own sentence and the paragraph beside it. */
type SwitchWording = { readonly switch: string; readonly text: string };

/** A consent given by picking one of the scopes `umfang` stores: the question, each option by the value it writes, and the paragraph. */
type ScopeWording = { readonly question: string; readonly options: Readonly<Record<FLEinwilligungUmfang, string>>; readonly text: string };

/**
 * Every consent wording a stored record can name, keyed by the label its evidence stamps as `text_version`. A record
 * proves what its person was shown only while its label's words stay as they were, so different words are a new label
 * beside the old, never an edit of one; `consentWordings.test.ts` fails an entry reworded in place.
 *
 * Outside `COPY` and `SERVER_COPY`, whose entries the copy standard rewords freely. A `{name}` slot is filled from the
 * record the page shows. A label's month is the month its words go live, which the deploy first serving them sets.
 */
export const CONSENT_WORDINGS = {
  "2026-11-whatsapp-1": {
    switch: "Die Liga darf mich auch über WhatsApp erreichen.",
    text: "Ist der Schalter an, schreiben wir dir für {team} in der Saison {saison} auch über WhatsApp; dann erhält WhatsApp deine Telefonnummer und unsere Nachrichten, und wir nutzen dafür die gewöhnliche App ohne Vertrag zur Auftragsverarbeitung. Ist er aus, erreichen wir dich per E-Mail oder Telefon. Der Schalter ist freiwillig; du schaltest ihn jederzeit in deinem Konto oder per E-Mail an kontakt@frankfurtleague.de aus, und was bis dahin geschah, bleibt rechtmäßig.",
  },
  "2026-11-medien-1": {
    switch: "Die Liga darf Fotos, Videos und Interviews von mir veröffentlichen.",
    text: "Ist der Schalter an, dürfen wir Fotos und Videos, auf denen du zu erkennen bist, und Interviews mit dir auf dieser Website und auf dem Instagram-Kanal der Liga veröffentlichen; Instagram betreibt Meta. Der Schalter ist freiwillig und zunächst aus; du schaltest ihn jederzeit in deinem Konto oder per E-Mail an kontakt@frankfurtleague.de aus, und was bis dahin geschah, bleibt rechtmäßig.",
  },
  "2026-11-name-kader-1": {
    question: "Was darf von deinem Namen auf der Website stehen?",
    options: {
      kader_oeffentlich: "Vorname und Anfangsbuchstabe des Nachnamens",
      intern: "Kein Name, nur Nummer und Position",
    },
    text: "Du entscheidest, ob dein Vorname und der Anfangsbuchstabe deines Nachnamens auf dieser Website im Kader deines Teams, in Aufstellungen und bei Toren und Karten stehen; ohne Namen steht dort „anonym“ mit deiner Rückennummer und Position. Am Mitspielen ändert die Wahl nichts. Du änderst sie jederzeit in deinem Konto oder per E-Mail an kontakt@frankfurtleague.de, und was bis dahin geschah, bleibt rechtmäßig.",
  },
  "2026-11-name-spielplan-1": {
    question: "Was darf von deinem Namen im Spielplan stehen?",
    options: {
      kader_oeffentlich: "Erster Teil des Namens und Anfangsbuchstabe des nächsten",
      intern: "Kein Name",
    },
    text: "Du entscheidest, ob an den Spielen, die du pfeifst, auf dieser Website der erste Teil deines Namens und der Anfangsbuchstabe des nächsten stehen, bei nur einem Namen dieser ganz; ohne Namen steht dort „anonym“. Am Pfeifen ändert die Wahl nichts. Du änderst sie jederzeit in deinem Konto oder per E-Mail an kontakt@frankfurtleague.de, und was bis dahin geschah, bleibt rechtmäßig.",
  },
} as const satisfies Readonly<Record<string, SwitchWording | ScopeWording>>;
