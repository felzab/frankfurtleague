/**
 * The words a contact person is shown, and the label a record stamps to name them. In `core` because
 * the public form renders them and the admin editor stamps the label: a copy per surface can drift.
 */
export type EinwilligungFassung = {
  readonly absaetze: readonly string[];
  readonly schalter: string;
};

// A stored record cites its label alone, so an entry here is never reworded or removed: either
// leaves a record claiming words nobody was shown. Spelling the league's name is not a rewording:
// the agreed words do not move.
export const LIGA_EINWILLIGUNGEN = {
  "2026-08": {
    absaetze: [
      "Ich bin damit einverstanden, dass die Frankfurt League meinen Namen, meine E-Mail-Adresse, meine " +
        "Telefonnummer und mein Geburtsdatum speichert und mich damit zu dieser Saison erreicht, auch über " +
        "WhatsApp. Diese Angaben bleiben in der Verwaltung der Liga und werden nirgends veröffentlicht. Ich " +
        "kann die Einwilligung jederzeit widerrufen.",
    ],
    schalter: "Ja, ich bin einverstanden",
  },
  "2026-09-bestaetigung": {
    absaetze: [
      "Die Liga speichert von jeder der drei Personen oben Vorname, Nachname, E-Mail-Adresse und " +
        "Telefonnummer, um das Team während dieser Saison zu erreichen. Diese Angaben bleiben in der " +
        "Verwaltung der Liga und werden nirgends veröffentlicht.",
      "Jede der drei Personen bekommt gleich eine eigene E-Mail mit einem persönlichen Link und bestätigt " +
        "dort selbst, dass die Angaben stimmen. Ihr Geburtsdatum trägt jede dort selbst ein, und daran " +
        "prüfen wir, ob sie mindestens 16 Jahre alt ist; hier im Formular brauchst Du es nicht. Solange " +
        "nicht alle bestätigt haben, bearbeiten wir die Bewerbung nicht; nach vierzehn Tagen ohne " +
        "vollständige Bestätigung löschen wir sie samt allen Kontaktdaten. Was wir mit den Daten sonst " +
        "machen und welche Rechte jede dieser Personen hat, steht in der Datenschutzerklärung.",
    ],
    schalter: "Ja, die Angaben stimmen, und die drei Personen wissen von ihrem Eintrag.",
  },
} as const satisfies Readonly<Record<string, EinwilligungFassung>>;

const AKTUELLE_FASSUNG = "2026-09-bestaetigung";

// Read off the record rather than spelled again, so a new wording and the bump that names it cannot
// land in separate edits.
export const LIGA_EINWILLIGUNG = {
  textVersion: AKTUELLE_FASSUNG,
  ...LIGA_EINWILLIGUNGEN[AKTUELLE_FASSUNG],
} as const;

/**
 * Answers the words a stored label cites, and never a fallback: the current wording under an old
 * label is a record claiming agreement to a text its person never read.
 */
export function einwilligungFassung(textVersion: string): EinwilligungFassung | null {
  const fassungen: Readonly<Record<string, EinwilligungFassung>> = LIGA_EINWILLIGUNGEN;

  // `hasOwn` before the index: a record read answers `Object.prototype`'s own members, so a label
  // spelling `toString` would resolve to a function rather than to nothing.
  return Object.hasOwn(fassungen, textVersion) ? (fassungen[textVersion] ?? null) : null;
}
