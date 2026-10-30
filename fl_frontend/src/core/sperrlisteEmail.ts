import "server-only";

import { KONTAKT_EMAIL } from "./brand";
import { BRAND_NAME, mailOrigin, WIDERSPRUCH } from "./emailShell";

import type { Mail } from "./emailShell";
import type { FLSperreDaten } from "./generated/client/types";
import type { MailOrt } from "./mailKinds";

/**
 * What is kept, named because the reader cannot be shown it, the account only while a record holds the
 * address (`docs/datenschutz.md :: 6`). It names no grant: a barred address holds none
 * (`sperrliste_verwaltung`, `berechtigung_gesperrt`).
 */
const GESPEICHERT_SAETZE = [
  "In der Sperrliste stehen nur ein Prüfwert Deiner Adresse, der Grund, das Datum und wer die Sperre eingetragen hat.",
  "Deine Adresse selbst steht dort nicht.",
  "Dein Konto bleibt nur bestehen, solange Du unter dieser Adresse noch etwas davon bei uns hast: einen Platz als Kontaktperson eines Teams in einer Saison oder in einer Bewerbung, über die noch nicht entschieden ist, einen Eintrag als Spielerin, Spieler, Schiedsrichterin oder Schiedsrichter oder eine bestätigte Registrierung, über die das Team noch nicht entschieden hat.",
] as const;

// Every refusal the ban reaches, in one sentence: a sign-in, a registration, a contact seat on an
// application and a referee's entry. „anmelden“ is the SIGN-IN's verb and „registrieren“ the season's.
const EINLEITUNG = [
  `Deine E-Mail-Adresse wurde von der Verwaltung der ${BRAND_NAME} gesperrt.`,
  "Mit ihr kannst Du Dich vorerst weder anmelden noch für eine Saison registrieren, und Du kannst weder als Kontaktperson in einer Bewerbung genannt noch als Schiedsrichterin oder Schiedsrichter eingetragen werden.",
] as const;

export function buildSperreEmail({ grund, gesperrt_bis_saison_id: gesperrtBisSaisonId }: FLSperreDaten, { origin }: MailOrt): Mail {
  return {
    art: "mitteilung",
    subjectLine: "Deine E-Mail-Adresse ist gesperrt",
    origin: mailOrigin(origin),
    vorname: "",
    absaetze: [
      [
        ...EINLEITUNG,
        // „werden beendet“: the mail leaves after the sign-out was attempted and cannot know whether it held.
        "Bestehende Anmeldungen mit dieser Adresse werden beendet.",
        // INCLUSIVE, where a bare „bis“ is not: a reader told the ban ends „bis 2031“ reads the whole of that season as free.
        [{ strong: `Die Sperre gilt bis einschließlich der Saison ${gesperrtBisSaisonId}.` }],
        // What the form's hint promises the mail explains, so the two say one thing.
        "Danach endet die Sperre von selbst. Du musst dafür nichts tun.",
      ],
      [`Angegebener Grund: ${grund}`],
      GESPEICHERT_SAETZE,
      // The one way to a copy or a deletion while the address cannot sign in, and how the league knows the
      // request is the address holder's.
      [
        ["Möchtest Du eine Kopie Deiner Daten oder ihre Löschung, schreib uns an ", { adresse: KONTAKT_EMAIL }, "."],
        "Wir bestätigen Deine Anfrage mit einer E-Mail an diese gesperrte Adresse.",
      ],
      // A barred address's confirmation link shows the ban's sentence and nothing else, so a contact person
      // withdrawing a consent that link took has only this mail to learn where it now goes.
      [["Einen Widerspruch gegen Deine Einwilligung nimmst Du weiterhin per E-Mail an ", { adresse: KONTAKT_EMAIL }, " vor."]],
      // Art. 6 (1) (f), named because the mail is the ONLY record this reader ever gets.
      [
        "Wir speichern diesen Eintrag auf Grundlage unseres berechtigten Interesses daran, eine gesperrte Adresse nicht erneut zuzulassen (Art. 6 Abs. 1 lit. f DSGVO).",
      ],
      // Art. 21 (4) asks that the right to object be brought to the reader's attention EXPLICITLY and
      // SEPARATELY at the first communication, which this message is: its own paragraph, the last, in the shell's
      // wording for every first contact.
      [WIDERSPRUCH, "Dort beantworten wir auch Fragen zur Sperre."],
    ],
  };
}
