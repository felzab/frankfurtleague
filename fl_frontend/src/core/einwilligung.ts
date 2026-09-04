/**
 * The words a contact person is shown, and the label a record stamps to name them. In `core` because
 * the two public forms render them and the admin editor stamps the label: a copy per surface can drift.
 */
export type EinwilligungFassung = {
  readonly absaetze: readonly string[];
  readonly schalter: string;
};

// A record cites its label alone, and every entry below stands inside „2026-09-bestaetigungsseite“,
// so a polish here rewords what a stored record claims its reader saw. Different words mean a new
// label, never an edit here.
/**
 * The confirmation page's standing text. A reader's own facts are `{slots}` rather than sentence
 * halves: a record stores those beside the label, so the two together reproduce the screen its
 * person pressed on.
 */
export const BESTAETIGUNG_ABSAETZE = {
  worum:
    "Für die Schule {schule} wurde eine Bewerbung um die Teilnahme an der Saison {saison} der Frankfurt League eingereicht. Darin " +
    "bist Du als {rolle} eingetragen. Die Person, die die Bewerbung abgeschickt hat, hat dabei Deinen Namen, Deine E-Mail-Adresse " +
    "und Deine Telefonnummer angegeben. Den Link zu dieser Seite hast Du bekommen, weil wir das nicht einfach so stehen lassen " +
    "wollen, sondern von Dir selbst hören möchten, dass es stimmt.",
  gespeichert:
    "Gespeichert sind Dein Vorname, Dein Nachname, Deine E-Mail-Adresse und Deine Telefonnummer. Wir brauchen sie, um das Team " +
    "dieser Schule während der Saison zu erreichen, also für Spielansetzungen, Absagen, Rückfragen und die Entscheidung über die " +
    "Bewerbung.",
  geburtsdatum:
    "Dein Geburtsdatum steht nicht in der Bewerbung. Du trägst es gleich hier selbst ein, und wir prüfen damit, ob Du mindestens " +
    "{minAlter} Jahre alt bist; unter {minAlter} kann bei uns niemand mitmachen. Vorher hatte es niemand, und niemand hat es für " +
    "Dich angegeben.",
  rechtsgrundlage:
    "Rechtsgrundlage ist Art. 6 Abs. 1 lit. b DSGVO, wenn Du selbst an der Liga teilnimmst, sonst Art. 6 Abs. 1 lit. f DSGVO. " +
    "Unser berechtigtes Interesse ist, ein Team über die von ihm selbst benannten Personen erreichen zu können, statt eine ganze " +
    "Saison an einer einzigen Adresse hängen zu lassen. Dass Deine Daten dabei nicht untergehen, sichern wir so ab: Du erfährst " +
    "von Deinem Eintrag sofort, nämlich jetzt; nichts davon wird veröffentlicht; und Du kannst jederzeit verlangen, dass wir " +
    "alles löschen.",
  nichtOeffentlich:
    "Deine Kontaktdaten werden nirgends veröffentlicht. Sie erscheinen weder auf der Teamseite noch im Spielplan noch sonst " +
    "irgendwo auf der Website, und sie werden nicht an andere Teams, andere Schulen oder Dritte weitergegeben. Sie bleiben in der " +
    "Verwaltung der Liga, und dort sehen sie nur die Administratorinnen und Administratoren.",
  fristAbgelehnt: "Wird die Bewerbung abgelehnt, löschen wir sie mit allen Kontaktdaten einen Monat nach der Entscheidung.",
  fristAngenommen:
    "Wird sie angenommen, behalten wir sie bis zum Ende der Saison, die auf {saison} folgt, und löschen Deine Kontaktdaten dann. " +
    "Für Dein Geburtsdatum gilt dieselbe Frist, gerechnet ab dem Tag, an dem Du es hier einträgst.",
  fristUnvollstaendig:
    "Bestätigen nicht alle eingetragenen Personen innerhalb von vierzehn Tagen, löschen wir die ganze Bewerbung samt allen Kontaktdaten.",
  ablehnen:
    "Du musst nicht bestätigen. Wenn Du nicht möchtest, dass wir Deine Daten haben, sag uns das über den Link „{ablehnen}“ oder " +
    "mit einer E-Mail an {kontakt}; wir löschen Deinen Eintrag dann und sagen der Person Bescheid, die die Bewerbung eingereicht " +
    "hat, damit sie jemand anderen benennen kann.",
  // The armed decline shows this, so a record citing this label has to reproduce it. A paragraph
  // may still join a label no record cites yet.
  ablehnenFolge: "Wir entfernen Deine Angaben sofort aus der Bewerbung und sagen der Person Bescheid, die sie eingereicht hat.",
  widerruf:
    "Auch nach einer Bestätigung kannst Du jederzeit die Löschung Deiner Daten verlangen (Art. 17 DSGVO) und der Verarbeitung " +
    "widersprechen (Art. 21 DSGVO). Eine Einwilligung, die man widerrufen müsste, gibt es hier nicht, außer der freiwilligen für " +
    "WhatsApp. Alle Deine Rechte und wie Du sie ausübst, stehen in der {datenschutz}. Für alles genügt eine formlose E-Mail an " +
    "{kontakt}.",
  whatsapp:
    "Dieser Schalter ist freiwillig und hat mit der Bestätigung oben nichts zu tun. Lässt Du ihn aus, erreichen wir Dich per " +
    "E-Mail und, wenn es eilt, telefonisch, und es entsteht Dir kein Nachteil. Schaltest Du ihn ein, gelangen Deine Telefonnummer " +
    "und die Nachrichten, die wir Dir schreiben, zu WhatsApp; wir nutzen dort die gewöhnliche App, für die kein " +
    "Auftragsverarbeitungsvertrag besteht. Du kannst diese Einwilligung jederzeit zurücknehmen, formlos mit einer E-Mail an " +
    "{kontakt}. Was bis dahin geschah, bleibt rechtmäßig.",
  klickIdentitaet: "dass Du {vorname} bist und diese E-Mail-Adresse Dir gehört,",
  klickEintrag: "dass Du von Deinem Eintrag als {rolle} für {schule} weißt und er richtig ist,",
  klickAlter: "dass Du mindestens {minAlter} Jahre alt bist, was wir an dem Geburtsdatum prüfen, das Du hier einträgst,",
  klickHinweise: "dass Du diese Hinweise und die Datenschutzerklärung lesen konntest.",
  keineEinwilligung:
    "Eine Einwilligung ist das nicht, und wir holen hier auch keine ein. Du bestätigst, was in der Bewerbung steht, und ergänzt " +
    "Dein Geburtsdatum; die Grundlage dafür steht oben.",
} as const;

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
  // A label of its own, never a second block in the entry above: that entry is stamped on the
  // applicant's and the admin editor's records, and neither reader saw a word of the page below.
  "2026-09-bestaetigungsseite": {
    absaetze: Object.values(BESTAETIGUNG_ABSAETZE),
    schalter: "Die Liga darf mich auch über WhatsApp erreichen.",
  },
} as const satisfies Readonly<Record<string, EinwilligungFassung>>;

const AKTUELLE_FASSUNG = "2026-09-bestaetigung";
const AKTUELLE_BESTAETIGUNG = "2026-09-bestaetigungsseite";

// Read off the record rather than spelled again, so a new wording and the bump that names it cannot
// land in separate edits.
export const LIGA_EINWILLIGUNG = {
  textVersion: AKTUELLE_FASSUNG,
  ...LIGA_EINWILLIGUNGEN[AKTUELLE_FASSUNG],
} as const;

/** The confirming person's own wording and label, read off the record for `LIGA_EINWILLIGUNG`'s reason. */
export const BESTAETIGUNG_EINWILLIGUNG = {
  textVersion: AKTUELLE_BESTAETIGUNG,
  ...LIGA_EINWILLIGUNGEN[AKTUELLE_BESTAETIGUNG],
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

/**
 * A stored wording with this reader's own facts in its slots.
 *
 * An unfilled slot is left standing rather than blanked: a sentence quietly missing its subject
 * reads as finished, and one still spelling `{rolle}` says which fact never arrived.
 */
export function fuelleFassung(text: string, werte: Readonly<Record<string, string>>): string {
  return text.replace(/\{(\w+)\}/g, (slot, name: string) => werte[name] ?? slot);
}
