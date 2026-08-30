/**
 * The wording every contact person agrees to, and the version stamped on a record made under it.
 *
 * **The two live in one object because the version NAMES the text.** A stored record cites the
 * version alone, so a rewording without a bump would leave every earlier record claiming agreement to
 * a text nobody was shown. Reword and bump in one edit.
 *
 * In `core` rather than in either feature: the public application form gathers this consent and the
 * admin editor transcribes the same one, so a copy per surface is two texts that can drift.
 */
export const LIGA_EINWILLIGUNG = {
  textVersion: "2026-08",
  text:
    "Ich bin damit einverstanden, dass die Frankfurt-League meinen Namen, meine E-Mail-Adresse, meine " +
    "Telefonnummer und mein Geburtsdatum speichert und mich damit zu dieser Saison erreicht, auch über " +
    "WhatsApp. Diese Angaben bleiben in der Verwaltung der Liga und werden nirgends veröffentlicht. Ich " +
    "kann die Einwilligung jederzeit widerrufen.",
} as const;
