/**
 * The wording every contact person agrees to, and the version stamped on a record made under it. In
 * `core` because the public form gathers this consent and the admin editor transcribes it: a copy per
 * surface is two texts that can drift.
 */
export const LIGA_EINWILLIGUNG = {
  // NAMES the text: a stored record cites the version alone, so a rewording without a bump leaves
  // every earlier record claiming agreement to a text nobody was shown. Reword and bump in one edit.
  textVersion: "2026-08",
  text:
    "Ich bin damit einverstanden, dass die Frankfurt-League meinen Namen, meine E-Mail-Adresse, meine " +
    "Telefonnummer und mein Geburtsdatum speichert und mich damit zu dieser Saison erreicht, auch über " +
    "WhatsApp. Diese Angaben bleiben in der Verwaltung der Liga und werden nirgends veröffentlicht. Ich " +
    "kann die Einwilligung jederzeit widerrufen.",
} as const;
