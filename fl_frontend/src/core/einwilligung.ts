/**
 * The words a contact person is shown, and the label a record stamps to name them. In `core` because
 * the two public forms render them and the admin editor stamps the label: a copy per surface can drift.
 */
export type EinwilligungFassung = {
  readonly absaetze: readonly string[];
  readonly schalter: string;
  /**
   * Every OTHER control the page decides a stored field with, keyed by the value it writes.
   *
   * A label outside the frozen wording is a sentence a record cannot reproduce beside the choice it
   * holds.
   */
  readonly bedienelemente: Readonly<Record<string, string>>;
};

// A record cites its label alone, and every entry below stands inside the label
// `AKTUELLE_BESTAETIGUNG` names, so a polish here rewords what a stored record claims its reader
// saw. Different words mean a new label, never an edit here.
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
    "{minAlter} Jahre alt bist. So alt muss sein, wer diese Rolle übernimmt. Vorher hatte es niemand, und niemand hat es für " +
    "Dich angegeben.",
  rechtsgrundlage:
    "Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO. Unser berechtigtes Interesse ist, den Spielbetrieb der Liga durchzuführen " +
    "und dafür ein Team über die von ihm selbst benannten Personen erreichen zu können, statt eine ganze Saison an einer " +
    "einzigen Adresse hängen zu lassen. Dass Deine Daten dabei nicht untergehen, sichern wir so ab: Du erfährst " +
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
    "Bestätigen nicht alle eingetragenen Personen innerhalb von vierzehn Tagen ab dem Versand der Bestätigungslinks, löschen wir " +
    "die ganze Bewerbung samt allen Kontaktdaten. Ersetzen wir einen Link durch einen neuen, beginnt diese Frist für die ganze " +
    "Bewerbung von vorn; eine Erinnerung verschiebt sie nicht.",
  fristOhneEntscheidung:
    "Bleibt die Bewerbung ohne Entscheidung, löschen wir sie samt allen Kontaktdaten und Deinem Geburtsdatum, sobald die Saison " +
    "{saison} vorbei ist.",
  // Named without a noun: the control is a button, and „Link“ on this page is the emailed
  // one that opened it.
  ablehnen:
    "Du musst nicht bestätigen. Wenn Du nicht möchtest, dass wir Deine Daten haben, sag uns das über „{ablehnen}“ oder " +
    "mit einer E-Mail an {kontakt}; wir löschen Deinen Eintrag dann und sagen der Person Bescheid, die die Bewerbung eingereicht " +
    "hat, damit sie jemand anderen benennen kann.",
  // The armed decline shows this, so a record citing this label has to reproduce it. A paragraph
  // may still join a label no record cites yet.
  ablehnenFolge: "Wir entfernen Deine Angaben sofort aus der Bewerbung und sagen der Person Bescheid, die sie eingereicht hat.",
  widerruf:
    "Auch nach einer Bestätigung kannst Du jederzeit die Löschung Deiner Daten verlangen (Art. 17 DSGVO). Eine Einwilligung, die " +
    "man widerrufen müsste, gibt es hier nicht, außer der freiwilligen für WhatsApp. Alle Deine Rechte und wie Du sie ausübst, " +
    "stehen in der {datenschutz}. Für alles genügt eine formlose E-Mail an {kontakt}.",
  // Its own paragraph and never a clause of the one above: Art. 21(4) DSGVO asks the objection to
  // stand apart from every other piece of information. Never keyed `widerspruch`, the glossary's
  // word for this page's decline door.
  art21:
    "Der Verarbeitung Deiner Daten kannst Du jederzeit aus Gründen widersprechen, die sich aus Deiner besonderen Situation " +
    "ergeben (Art. 21 DSGVO).",
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

// Spelled out rather than read from the map: the map is what the page renders, so a label
// reading it would follow the next rewording and stop answering what its own records cite.
const BESTAETIGUNGSSEITE_ABSAETZE_2026_09 = [
  "Für die Schule {schule} wurde eine Bewerbung um die Teilnahme an der Saison {saison} der Frankfurt League eingereicht. Darin bist Du als {rolle} eingetragen. Die Person, die die Bewerbung abgeschickt hat, hat dabei Deinen Namen, Deine E-Mail-Adresse und Deine Telefonnummer angegeben. Den Link zu dieser Seite hast Du bekommen, weil wir das nicht einfach so stehen lassen wollen, sondern von Dir selbst hören möchten, dass es stimmt.",
  "Gespeichert sind Dein Vorname, Dein Nachname, Deine E-Mail-Adresse und Deine Telefonnummer. Wir brauchen sie, um das Team dieser Schule während der Saison zu erreichen, also für Spielansetzungen, Absagen, Rückfragen und die Entscheidung über die Bewerbung.",
  "Dein Geburtsdatum steht nicht in der Bewerbung. Du trägst es gleich hier selbst ein, und wir prüfen damit, ob Du mindestens {minAlter} Jahre alt bist; unter {minAlter} kann bei uns niemand mitmachen. Vorher hatte es niemand, und niemand hat es für Dich angegeben.",
  "Rechtsgrundlage ist Art. 6 Abs. 1 lit. b DSGVO, wenn Du selbst an der Liga teilnimmst, sonst Art. 6 Abs. 1 lit. f DSGVO. Unser berechtigtes Interesse ist, ein Team über die von ihm selbst benannten Personen erreichen zu können, statt eine ganze Saison an einer einzigen Adresse hängen zu lassen. Dass Deine Daten dabei nicht untergehen, sichern wir so ab: Du erfährst von Deinem Eintrag sofort, nämlich jetzt; nichts davon wird veröffentlicht; und Du kannst jederzeit verlangen, dass wir alles löschen.",
  "Deine Kontaktdaten werden nirgends veröffentlicht. Sie erscheinen weder auf der Teamseite noch im Spielplan noch sonst irgendwo auf der Website, und sie werden nicht an andere Teams, andere Schulen oder Dritte weitergegeben. Sie bleiben in der Verwaltung der Liga, und dort sehen sie nur die Administratorinnen und Administratoren.",
  "Wird die Bewerbung abgelehnt, löschen wir sie mit allen Kontaktdaten einen Monat nach der Entscheidung.",
  "Wird sie angenommen, behalten wir sie bis zum Ende der Saison, die auf {saison} folgt, und löschen Deine Kontaktdaten dann. Für Dein Geburtsdatum gilt dieselbe Frist, gerechnet ab dem Tag, an dem Du es hier einträgst.",
  "Bestätigen nicht alle eingetragenen Personen innerhalb von vierzehn Tagen, löschen wir die ganze Bewerbung samt allen Kontaktdaten.",
  "Du musst nicht bestätigen. Wenn Du nicht möchtest, dass wir Deine Daten haben, sag uns das über den Link „{ablehnen}“ oder mit einer E-Mail an {kontakt}; wir löschen Deinen Eintrag dann und sagen der Person Bescheid, die die Bewerbung eingereicht hat, damit sie jemand anderen benennen kann.",
  "Wir entfernen Deine Angaben sofort aus der Bewerbung und sagen der Person Bescheid, die sie eingereicht hat.",
  "Auch nach einer Bestätigung kannst Du jederzeit die Löschung Deiner Daten verlangen (Art. 17 DSGVO) und der Verarbeitung widersprechen (Art. 21 DSGVO). Eine Einwilligung, die man widerrufen müsste, gibt es hier nicht, außer der freiwilligen für WhatsApp. Alle Deine Rechte und wie Du sie ausübst, stehen in der {datenschutz}. Für alles genügt eine formlose E-Mail an {kontakt}.",
  "Dieser Schalter ist freiwillig und hat mit der Bestätigung oben nichts zu tun. Lässt Du ihn aus, erreichen wir Dich per E-Mail und, wenn es eilt, telefonisch, und es entsteht Dir kein Nachteil. Schaltest Du ihn ein, gelangen Deine Telefonnummer und die Nachrichten, die wir Dir schreiben, zu WhatsApp; wir nutzen dort die gewöhnliche App, für die kein Auftragsverarbeitungsvertrag besteht. Du kannst diese Einwilligung jederzeit zurücknehmen, formlos mit einer E-Mail an {kontakt}. Was bis dahin geschah, bleibt rechtmäßig.",
  "dass Du {vorname} bist und diese E-Mail-Adresse Dir gehört,",
  "dass Du von Deinem Eintrag als {rolle} für {schule} weißt und er richtig ist,",
  "dass Du mindestens {minAlter} Jahre alt bist, was wir an dem Geburtsdatum prüfen, das Du hier einträgst,",
  "dass Du diese Hinweise und die Datenschutzerklärung lesen konntest.",
  "Eine Einwilligung ist das nicht, und wir holen hier auch keine ein. Du bestätigst, was in der Bewerbung steht, und ergänzt Dein Geburtsdatum; die Grundlage dafür steht oben.",
] as const;

// Spelled out for the reason above: the map holds a later wording, and these are the words the
// second label's records cite.
const BESTAETIGUNGSSEITE_ABSAETZE_2026_09_2 = [
  "Für die Schule {schule} wurde eine Bewerbung um die Teilnahme an der Saison {saison} der Frankfurt League eingereicht. Darin bist Du als {rolle} eingetragen. Die Person, die die Bewerbung abgeschickt hat, hat dabei Deinen Namen, Deine E-Mail-Adresse und Deine Telefonnummer angegeben. Den Link zu dieser Seite hast Du bekommen, weil wir das nicht einfach so stehen lassen wollen, sondern von Dir selbst hören möchten, dass es stimmt.",
  "Gespeichert sind Dein Vorname, Dein Nachname, Deine E-Mail-Adresse und Deine Telefonnummer. Wir brauchen sie, um das Team dieser Schule während der Saison zu erreichen, also für Spielansetzungen, Absagen, Rückfragen und die Entscheidung über die Bewerbung.",
  "Dein Geburtsdatum steht nicht in der Bewerbung. Du trägst es gleich hier selbst ein, und wir prüfen damit, ob Du mindestens {minAlter} Jahre alt bist; unter {minAlter} kann bei uns niemand mitmachen. Vorher hatte es niemand, und niemand hat es für Dich angegeben.",
  "Rechtsgrundlage ist Art. 6 Abs. 1 lit. b DSGVO, wenn Du selbst an der Liga teilnimmst, sonst Art. 6 Abs. 1 lit. f DSGVO. Unser berechtigtes Interesse ist, ein Team über die von ihm selbst benannten Personen erreichen zu können, statt eine ganze Saison an einer einzigen Adresse hängen zu lassen. Dass Deine Daten dabei nicht untergehen, sichern wir so ab: Du erfährst von Deinem Eintrag sofort, nämlich jetzt; nichts davon wird veröffentlicht; und Du kannst jederzeit verlangen, dass wir alles löschen.",
  "Deine Kontaktdaten werden nirgends veröffentlicht. Sie erscheinen weder auf der Teamseite noch im Spielplan noch sonst irgendwo auf der Website, und sie werden nicht an andere Teams, andere Schulen oder Dritte weitergegeben. Sie bleiben in der Verwaltung der Liga, und dort sehen sie nur die Administratorinnen und Administratoren.",
  "Wird die Bewerbung abgelehnt, löschen wir sie mit allen Kontaktdaten einen Monat nach der Entscheidung.",
  "Wird sie angenommen, behalten wir sie bis zum Ende der Saison, die auf {saison} folgt, und löschen Deine Kontaktdaten dann. Für Dein Geburtsdatum gilt dieselbe Frist, gerechnet ab dem Tag, an dem Du es hier einträgst.",
  "Bestätigen nicht alle eingetragenen Personen innerhalb von vierzehn Tagen, löschen wir die ganze Bewerbung samt allen Kontaktdaten.",
  "Du musst nicht bestätigen. Wenn Du nicht möchtest, dass wir Deine Daten haben, sag uns das über „{ablehnen}“ oder mit einer E-Mail an {kontakt}; wir löschen Deinen Eintrag dann und sagen der Person Bescheid, die die Bewerbung eingereicht hat, damit sie jemand anderen benennen kann.",
  "Wir entfernen Deine Angaben sofort aus der Bewerbung und sagen der Person Bescheid, die sie eingereicht hat.",
  "Auch nach einer Bestätigung kannst Du jederzeit die Löschung Deiner Daten verlangen (Art. 17 DSGVO) und der Verarbeitung widersprechen (Art. 21 DSGVO). Eine Einwilligung, die man widerrufen müsste, gibt es hier nicht, außer der freiwilligen für WhatsApp. Alle Deine Rechte und wie Du sie ausübst, stehen in der {datenschutz}. Für alles genügt eine formlose E-Mail an {kontakt}.",
  "Dieser Schalter ist freiwillig und hat mit der Bestätigung oben nichts zu tun. Lässt Du ihn aus, erreichen wir Dich per E-Mail und, wenn es eilt, telefonisch, und es entsteht Dir kein Nachteil. Schaltest Du ihn ein, gelangen Deine Telefonnummer und die Nachrichten, die wir Dir schreiben, zu WhatsApp; wir nutzen dort die gewöhnliche App, für die kein Auftragsverarbeitungsvertrag besteht. Du kannst diese Einwilligung jederzeit zurücknehmen, formlos mit einer E-Mail an {kontakt}. Was bis dahin geschah, bleibt rechtmäßig.",
  "dass Du {vorname} bist und diese E-Mail-Adresse Dir gehört,",
  "dass Du von Deinem Eintrag als {rolle} für {schule} weißt und er richtig ist,",
  "dass Du mindestens {minAlter} Jahre alt bist, was wir an dem Geburtsdatum prüfen, das Du hier einträgst,",
  "dass Du diese Hinweise und die Datenschutzerklärung lesen konntest.",
  "Eine Einwilligung ist das nicht, und wir holen hier auch keine ein. Du bestätigst, was in der Bewerbung steht, und ergänzt Dein Geburtsdatum; die Grundlage dafür steht oben.",
] as const;

// Spelled out for the reason above: the map holds a later wording, and these are the words the
// third label's records cite.
const BESTAETIGUNGSSEITE_ABSAETZE_2026_09_3 = [
  "Für die Schule {schule} wurde eine Bewerbung um die Teilnahme an der Saison {saison} der Frankfurt League eingereicht. Darin bist Du als {rolle} eingetragen. Die Person, die die Bewerbung abgeschickt hat, hat dabei Deinen Namen, Deine E-Mail-Adresse und Deine Telefonnummer angegeben. Den Link zu dieser Seite hast Du bekommen, weil wir das nicht einfach so stehen lassen wollen, sondern von Dir selbst hören möchten, dass es stimmt.",
  "Gespeichert sind Dein Vorname, Dein Nachname, Deine E-Mail-Adresse und Deine Telefonnummer. Wir brauchen sie, um das Team dieser Schule während der Saison zu erreichen, also für Spielansetzungen, Absagen, Rückfragen und die Entscheidung über die Bewerbung.",
  "Dein Geburtsdatum steht nicht in der Bewerbung. Du trägst es gleich hier selbst ein, und wir prüfen damit, ob Du mindestens {minAlter} Jahre alt bist; unter {minAlter} kann bei uns niemand mitmachen. Vorher hatte es niemand, und niemand hat es für Dich angegeben.",
  "Rechtsgrundlage ist Art. 6 Abs. 1 lit. b DSGVO, wenn Du selbst an der Liga teilnimmst, sonst Art. 6 Abs. 1 lit. f DSGVO. Unser berechtigtes Interesse ist, ein Team über die von ihm selbst benannten Personen erreichen zu können, statt eine ganze Saison an einer einzigen Adresse hängen zu lassen. Dass Deine Daten dabei nicht untergehen, sichern wir so ab: Du erfährst von Deinem Eintrag sofort, nämlich jetzt; nichts davon wird veröffentlicht; und Du kannst jederzeit verlangen, dass wir alles löschen.",
  "Deine Kontaktdaten werden nirgends veröffentlicht. Sie erscheinen weder auf der Teamseite noch im Spielplan noch sonst irgendwo auf der Website, und sie werden nicht an andere Teams, andere Schulen oder Dritte weitergegeben. Sie bleiben in der Verwaltung der Liga, und dort sehen sie nur die Administratorinnen und Administratoren.",
  "Wird die Bewerbung abgelehnt, löschen wir sie mit allen Kontaktdaten einen Monat nach der Entscheidung.",
  "Wird sie angenommen, behalten wir sie bis zum Ende der Saison, die auf {saison} folgt, und löschen Deine Kontaktdaten dann. Für Dein Geburtsdatum gilt dieselbe Frist, gerechnet ab dem Tag, an dem Du es hier einträgst.",
  "Bestätigen nicht alle eingetragenen Personen innerhalb von vierzehn Tagen ab dem Versand der Bestätigungslinks, löschen wir die ganze Bewerbung samt allen Kontaktdaten. Ersetzen wir einen Link durch einen neuen, beginnt diese Frist für die ganze Bewerbung von vorn; eine Erinnerung verschiebt sie nicht.",
  "Du musst nicht bestätigen. Wenn Du nicht möchtest, dass wir Deine Daten haben, sag uns das über „{ablehnen}“ oder mit einer E-Mail an {kontakt}; wir löschen Deinen Eintrag dann und sagen der Person Bescheid, die die Bewerbung eingereicht hat, damit sie jemand anderen benennen kann.",
  "Wir entfernen Deine Angaben sofort aus der Bewerbung und sagen der Person Bescheid, die sie eingereicht hat.",
  "Auch nach einer Bestätigung kannst Du jederzeit die Löschung Deiner Daten verlangen (Art. 17 DSGVO) und der Verarbeitung widersprechen (Art. 21 DSGVO). Eine Einwilligung, die man widerrufen müsste, gibt es hier nicht, außer der freiwilligen für WhatsApp. Alle Deine Rechte und wie Du sie ausübst, stehen in der {datenschutz}. Für alles genügt eine formlose E-Mail an {kontakt}.",
  "Dieser Schalter ist freiwillig und hat mit der Bestätigung oben nichts zu tun. Lässt Du ihn aus, erreichen wir Dich per E-Mail und, wenn es eilt, telefonisch, und es entsteht Dir kein Nachteil. Schaltest Du ihn ein, gelangen Deine Telefonnummer und die Nachrichten, die wir Dir schreiben, zu WhatsApp; wir nutzen dort die gewöhnliche App, für die kein Auftragsverarbeitungsvertrag besteht. Du kannst diese Einwilligung jederzeit zurücknehmen, formlos mit einer E-Mail an {kontakt}. Was bis dahin geschah, bleibt rechtmäßig.",
  "dass Du {vorname} bist und diese E-Mail-Adresse Dir gehört,",
  "dass Du von Deinem Eintrag als {rolle} für {schule} weißt und er richtig ist,",
  "dass Du mindestens {minAlter} Jahre alt bist, was wir an dem Geburtsdatum prüfen, das Du hier einträgst,",
  "dass Du diese Hinweise und die Datenschutzerklärung lesen konntest.",
  "Eine Einwilligung ist das nicht, und wir holen hier auch keine ein. Du bestätigst, was in der Bewerbung steht, und ergänzt Dein Geburtsdatum; die Grundlage dafür steht oben.",
] as const;

// Spelled out for the reason above: the map holds a later wording, and these are the words the
// fourth label's records cite.
const BESTAETIGUNGSSEITE_ABSAETZE_2026_09_4 = [
  "Für die Schule {schule} wurde eine Bewerbung um die Teilnahme an der Saison {saison} der Frankfurt League eingereicht. Darin bist Du als {rolle} eingetragen. Die Person, die die Bewerbung abgeschickt hat, hat dabei Deinen Namen, Deine E-Mail-Adresse und Deine Telefonnummer angegeben. Den Link zu dieser Seite hast Du bekommen, weil wir das nicht einfach so stehen lassen wollen, sondern von Dir selbst hören möchten, dass es stimmt.",
  "Gespeichert sind Dein Vorname, Dein Nachname, Deine E-Mail-Adresse und Deine Telefonnummer. Wir brauchen sie, um das Team dieser Schule während der Saison zu erreichen, also für Spielansetzungen, Absagen, Rückfragen und die Entscheidung über die Bewerbung.",
  "Dein Geburtsdatum steht nicht in der Bewerbung. Du trägst es gleich hier selbst ein, und wir prüfen damit, ob Du mindestens {minAlter} Jahre alt bist; unter {minAlter} kann bei uns niemand mitmachen. Vorher hatte es niemand, und niemand hat es für Dich angegeben.",
  "Rechtsgrundlage ist Art. 6 Abs. 1 lit. b DSGVO, wenn Du selbst an der Liga teilnimmst, sonst Art. 6 Abs. 1 lit. f DSGVO. Unser berechtigtes Interesse ist, ein Team über die von ihm selbst benannten Personen erreichen zu können, statt eine ganze Saison an einer einzigen Adresse hängen zu lassen. Dass Deine Daten dabei nicht untergehen, sichern wir so ab: Du erfährst von Deinem Eintrag sofort, nämlich jetzt; nichts davon wird veröffentlicht; und Du kannst jederzeit verlangen, dass wir alles löschen.",
  "Deine Kontaktdaten werden nirgends veröffentlicht. Sie erscheinen weder auf der Teamseite noch im Spielplan noch sonst irgendwo auf der Website, und sie werden nicht an andere Teams, andere Schulen oder Dritte weitergegeben. Sie bleiben in der Verwaltung der Liga, und dort sehen sie nur die Administratorinnen und Administratoren.",
  "Wird die Bewerbung abgelehnt, löschen wir sie mit allen Kontaktdaten einen Monat nach der Entscheidung.",
  "Wird sie angenommen, behalten wir sie bis zum Ende der Saison, die auf {saison} folgt, und löschen Deine Kontaktdaten dann. Für Dein Geburtsdatum gilt dieselbe Frist, gerechnet ab dem Tag, an dem Du es hier einträgst.",
  "Bestätigen nicht alle eingetragenen Personen innerhalb von vierzehn Tagen ab dem Versand der Bestätigungslinks, löschen wir die ganze Bewerbung samt allen Kontaktdaten. Ersetzen wir einen Link durch einen neuen, beginnt diese Frist für die ganze Bewerbung von vorn; eine Erinnerung verschiebt sie nicht.",
  "Bleibt die Bewerbung ohne Entscheidung, löschen wir sie samt allen Kontaktdaten und Deinem Geburtsdatum, sobald die Saison {saison} vorbei ist.",
  "Du musst nicht bestätigen. Wenn Du nicht möchtest, dass wir Deine Daten haben, sag uns das über „{ablehnen}“ oder mit einer E-Mail an {kontakt}; wir löschen Deinen Eintrag dann und sagen der Person Bescheid, die die Bewerbung eingereicht hat, damit sie jemand anderen benennen kann.",
  "Wir entfernen Deine Angaben sofort aus der Bewerbung und sagen der Person Bescheid, die sie eingereicht hat.",
  "Auch nach einer Bestätigung kannst Du jederzeit die Löschung Deiner Daten verlangen (Art. 17 DSGVO) und der Verarbeitung widersprechen (Art. 21 DSGVO). Eine Einwilligung, die man widerrufen müsste, gibt es hier nicht, außer der freiwilligen für WhatsApp. Alle Deine Rechte und wie Du sie ausübst, stehen in der {datenschutz}. Für alles genügt eine formlose E-Mail an {kontakt}.",
  "Dieser Schalter ist freiwillig und hat mit der Bestätigung oben nichts zu tun. Lässt Du ihn aus, erreichen wir Dich per E-Mail und, wenn es eilt, telefonisch, und es entsteht Dir kein Nachteil. Schaltest Du ihn ein, gelangen Deine Telefonnummer und die Nachrichten, die wir Dir schreiben, zu WhatsApp; wir nutzen dort die gewöhnliche App, für die kein Auftragsverarbeitungsvertrag besteht. Du kannst diese Einwilligung jederzeit zurücknehmen, formlos mit einer E-Mail an {kontakt}. Was bis dahin geschah, bleibt rechtmäßig.",
  "dass Du {vorname} bist und diese E-Mail-Adresse Dir gehört,",
  "dass Du von Deinem Eintrag als {rolle} für {schule} weißt und er richtig ist,",
  "dass Du mindestens {minAlter} Jahre alt bist, was wir an dem Geburtsdatum prüfen, das Du hier einträgst,",
  "dass Du diese Hinweise und die Datenschutzerklärung lesen konntest.",
  "Eine Einwilligung ist das nicht, und wir holen hier auch keine ein. Du bestätigst, was in der Bewerbung steht, und ergänzt Dein Geburtsdatum; die Grundlage dafür steht oben.",
] as const;

// Spelled out for the reason above: these are the words the fifth label's records cite, whatever the
// map holds.
const BESTAETIGUNGSSEITE_ABSAETZE_2026_09_5 = [
  "Für die Schule {schule} wurde eine Bewerbung um die Teilnahme an der Saison {saison} der Frankfurt League eingereicht. Darin bist Du als {rolle} eingetragen. Die Person, die die Bewerbung abgeschickt hat, hat dabei Deinen Namen, Deine E-Mail-Adresse und Deine Telefonnummer angegeben. Den Link zu dieser Seite hast Du bekommen, weil wir das nicht einfach so stehen lassen wollen, sondern von Dir selbst hören möchten, dass es stimmt.",
  "Gespeichert sind Dein Vorname, Dein Nachname, Deine E-Mail-Adresse und Deine Telefonnummer. Wir brauchen sie, um das Team dieser Schule während der Saison zu erreichen, also für Spielansetzungen, Absagen, Rückfragen und die Entscheidung über die Bewerbung.",
  "Dein Geburtsdatum steht nicht in der Bewerbung. Du trägst es gleich hier selbst ein, und wir prüfen damit, ob Du mindestens {minAlter} Jahre alt bist. So alt muss sein, wer diese Rolle übernimmt. Vorher hatte es niemand, und niemand hat es für Dich angegeben.",
  "Rechtsgrundlage ist Art. 6 Abs. 1 lit. b DSGVO, wenn Du selbst an der Liga teilnimmst, sonst Art. 6 Abs. 1 lit. f DSGVO. Unser berechtigtes Interesse ist, ein Team über die von ihm selbst benannten Personen erreichen zu können, statt eine ganze Saison an einer einzigen Adresse hängen zu lassen. Dass Deine Daten dabei nicht untergehen, sichern wir so ab: Du erfährst von Deinem Eintrag sofort, nämlich jetzt; nichts davon wird veröffentlicht; und Du kannst jederzeit verlangen, dass wir alles löschen.",
  "Deine Kontaktdaten werden nirgends veröffentlicht. Sie erscheinen weder auf der Teamseite noch im Spielplan noch sonst irgendwo auf der Website, und sie werden nicht an andere Teams, andere Schulen oder Dritte weitergegeben. Sie bleiben in der Verwaltung der Liga, und dort sehen sie nur die Administratorinnen und Administratoren.",
  "Wird die Bewerbung abgelehnt, löschen wir sie mit allen Kontaktdaten einen Monat nach der Entscheidung.",
  "Wird sie angenommen, behalten wir sie bis zum Ende der Saison, die auf {saison} folgt, und löschen Deine Kontaktdaten dann. Für Dein Geburtsdatum gilt dieselbe Frist, gerechnet ab dem Tag, an dem Du es hier einträgst.",
  "Bestätigen nicht alle eingetragenen Personen innerhalb von vierzehn Tagen ab dem Versand der Bestätigungslinks, löschen wir die ganze Bewerbung samt allen Kontaktdaten. Ersetzen wir einen Link durch einen neuen, beginnt diese Frist für die ganze Bewerbung von vorn; eine Erinnerung verschiebt sie nicht.",
  "Bleibt die Bewerbung ohne Entscheidung, löschen wir sie samt allen Kontaktdaten und Deinem Geburtsdatum, sobald die Saison {saison} vorbei ist.",
  "Du musst nicht bestätigen. Wenn Du nicht möchtest, dass wir Deine Daten haben, sag uns das über „{ablehnen}“ oder mit einer E-Mail an {kontakt}; wir löschen Deinen Eintrag dann und sagen der Person Bescheid, die die Bewerbung eingereicht hat, damit sie jemand anderen benennen kann.",
  "Wir entfernen Deine Angaben sofort aus der Bewerbung und sagen der Person Bescheid, die sie eingereicht hat.",
  "Auch nach einer Bestätigung kannst Du jederzeit die Löschung Deiner Daten verlangen (Art. 17 DSGVO) und der Verarbeitung widersprechen (Art. 21 DSGVO). Eine Einwilligung, die man widerrufen müsste, gibt es hier nicht, außer der freiwilligen für WhatsApp. Alle Deine Rechte und wie Du sie ausübst, stehen in der {datenschutz}. Für alles genügt eine formlose E-Mail an {kontakt}.",
  "Dieser Schalter ist freiwillig und hat mit der Bestätigung oben nichts zu tun. Lässt Du ihn aus, erreichen wir Dich per E-Mail und, wenn es eilt, telefonisch, und es entsteht Dir kein Nachteil. Schaltest Du ihn ein, gelangen Deine Telefonnummer und die Nachrichten, die wir Dir schreiben, zu WhatsApp; wir nutzen dort die gewöhnliche App, für die kein Auftragsverarbeitungsvertrag besteht. Du kannst diese Einwilligung jederzeit zurücknehmen, formlos mit einer E-Mail an {kontakt}. Was bis dahin geschah, bleibt rechtmäßig.",
  "dass Du {vorname} bist und diese E-Mail-Adresse Dir gehört,",
  "dass Du von Deinem Eintrag als {rolle} für {schule} weißt und er richtig ist,",
  "dass Du mindestens {minAlter} Jahre alt bist, was wir an dem Geburtsdatum prüfen, das Du hier einträgst,",
  "dass Du diese Hinweise und die Datenschutzerklärung lesen konntest.",
  "Eine Einwilligung ist das nicht, und wir holen hier auch keine ein. Du bestätigst, was in der Bewerbung steht, und ergänzt Dein Geburtsdatum; die Grundlage dafür steht oben.",
] as const;

// Spelled out for the reason above: these are the words the first pupil label's records cite,
// whatever `SPIELER_ABSAETZE` holds.
const SPIELERSEITE_ABSAETZE_2026_09 = [
  "Du hast Dich über den Link Deines Teams {team} ({schule}) für die Saison {saison} der Frankfurt League registriert. Auf dieser Seite bestätigst Du diese Registrierung und entscheidest, was wir mit Deinen Angaben tun dürfen. Erst danach kann Dein Team Dich in seinen Kader aufnehmen.",
  "Gespeichert sind Dein Vorname, Dein Nachname, Deine E-Mail-Adresse, Deine Rückennummer, Deine Position und Deine Stufe sowie das Geburtsdatum, das Du gleich hier einträgst. Deine E-Mail-Adresse ist zugleich Dein Zugang zur Website: Du meldest Dich damit ohne Passwort an und siehst dort jederzeit, was wir über Dich gespeichert haben.",
  "Mitspielen kann nur, wer mindestens {minAlter} Jahre alt ist. Das prüfen wir an dem Geburtsdatum, das Du hier einträgst; niemand hat es vorher für Dich angegeben. Ein falsches Geburtsdatum beendet die Teilnahme: Wir schließen den Zugang, und mit dieser E-Mail-Adresse ist für fünf volle Saisons keine neue Registrierung möglich.",
  "Trainerin oder Trainer, Ansprechperson und Stellvertretung Deines Teams sehen Deinen Namen, Deine Nummer, Deine Position und Deine Stufe, entscheiden über die Aufnahme in den Kader und können Nummer, Position, Stufe und die Kapitänsrolle anpassen. Deine E-Mail-Adresse und Dein Geburtsdatum sehen nur die Administratorinnen und Administratoren der Liga.",
  "Du entscheidest, ob Dein Vorname und der Anfangsbuchstabe Deines Nachnamens auf der Website erscheinen: in der Kaderliste Deines Teams, in Aufstellungen und bei Torschützen und Karten. Mehr als das steht dort in keinem Fall: nie Dein voller Nachname. Wählst Du „intern“, stehen dort nur Deine Nummer und Deine Position, und an der Stelle Deines Namens steht „anonym“. Am Mitspielen ändert diese Wahl nichts, und Du kannst sie jederzeit in Deinem Zugang umstellen.",
  "Unabhängig davon kannst Du erlauben, dass Fotos, Videos und Interviews, die im Rahmen der Liga von Dir entstehen, veröffentlicht werden. Diese Erlaubnis ist freiwillig und zunächst ausgeschaltet; ohne sie entsteht Dir kein Nachteil, und auch sie kannst Du jederzeit in Deinem Zugang zurücknehmen.",
  "Rechtsgrundlage für die Veröffentlichung Deines Vornamens und des Anfangsbuchstabens Deines Nachnamens und für Fotos, Videos und Interviews ist Deine Einwilligung (Art. 6 Abs. 1 lit. a und Art. 7 DSGVO). Was wir zur Durchführung des Spielbetriebs brauchen, sind Name, E-Mail-Adresse, Nummer, Position, Stufe und Geburtsdatum in der Verwaltung der Liga. Rechtsgrundlage dafür ist Deine Teilnahme selbst (Art. 6 Abs. 1 lit. b DSGVO).",
  "Bestätigst Du diese Seite nicht innerhalb von sieben Tagen, löschen wir die Registrierung von selbst; Du kannst Dich dann über den Link Deines Teams erneut registrieren. Deine Angaben behalten wir, bis in der nächsten Saison die Registrierung geschlossen ist. Registrierst Du Dich dort wieder mit derselben E-Mail-Adresse, bleiben sie erhalten und Du musst nur Deine Wahl bestätigen; andernfalls löschen wir sie dann vollständig.",
  "Du kannst jede Einwilligung jederzeit zurücknehmen (Art. 7 Abs. 3 DSGVO); was bis dahin geschehen ist, bleibt rechtmäßig. Du kannst außerdem jederzeit die Löschung aller Deiner Daten verlangen (Art. 17 DSGVO): direkt in Deinem Zugang über „{loeschung}“ oder mit einer formlosen E-Mail an {kontakt}. Alle Deine Rechte und wie Du sie ausübst, stehen in der {datenschutz}.",
  "dass Du {vorname} bist und diese E-Mail-Adresse Dir gehört,",
  "dass Du mindestens {minAlter} Jahre alt bist, was wir an dem Geburtsdatum prüfen, das Du hier einträgst,",
  "dass Du in die Veröffentlichung Deines Vornamens und des Anfangsbuchstabens Deines Nachnamens so einwilligst, wie Du es oben gewählt hast, und in Fotos, Videos und Interviews nur, wenn Du den Schalter eingeschaltet hast,",
  "dass Du diese Hinweise und die Datenschutzerklärung lesen konntest.",
] as const;

// Spelled out for the reason above: these are the words the first referee label's records cite,
// whatever `SCHIEDSRICHTER_ABSAETZE` holds.
const SCHIEDSRICHTERSEITE_ABSAETZE_2026_09 = [
  "Die Verwaltung der Frankfurt League hat Dich als Schiedsrichterin oder Schiedsrichter eingetragen und Dir dafür diesen Link geschickt. Auf dieser Seite bestätigst Du den Eintrag und entscheidest, was wir mit Deinen Angaben tun dürfen.",
  "Gespeichert sind Dein Vorname, Dein Nachname, Deine Schule, Deine E-Mail-Adresse und Deine Telefonnummer, die für Dich hinterlegte Aufwandsentschädigung je Spiel sowie das Geburtsdatum, das Du gleich hier einträgst. Deine E-Mail-Adresse ist zugleich Dein Zugang zur Website: Du meldest Dich damit ohne Passwort an, nimmst dort Ansetzungen an oder lehnst sie ab, reichst Spielberichte ein und siehst jederzeit, was wir über Dich gespeichert haben.",
  "Spiele leiten kann nur, wer mindestens {minAlter} Jahre alt ist. Das prüfen wir an dem Geburtsdatum, das Du hier einträgst; niemand hat es vorher für Dich angegeben.",
  "Deine Schule, Deine Kontaktdaten, die Aufwandsentschädigung und Dein Geburtsdatum sehen nur die Administratorinnen und Administratoren der Liga. Diese Angaben werden nirgends veröffentlicht und nicht an Teams, Schulen oder Dritte weitergegeben.",
  "Du entscheidest, ob Dein Vorname und der Anfangsbuchstabe Deines Nachnamens im Spielplan bei den Spielen erscheinen, die Du leitest. Mehr als das steht dort in keinem Fall: nie Dein voller Nachname. Wählst Du „intern“, steht dort an der Stelle Deines Namens „anonym“. Am Leiten von Spielen ändert diese Wahl nichts, und Du kannst sie jederzeit in Deinem Zugang umstellen.",
  "Unabhängig davon kannst Du erlauben, dass Fotos, Videos und Interviews, die im Rahmen der Liga von Dir entstehen, veröffentlicht werden. Diese Erlaubnis ist freiwillig und zunächst ausgeschaltet; ohne sie entsteht Dir kein Nachteil, und auch sie kannst Du jederzeit in Deinem Zugang zurücknehmen.",
  "Rechtsgrundlage für die Veröffentlichung Deines Vornamens und des Anfangsbuchstabens Deines Nachnamens und für Fotos, Videos und Interviews ist Deine Einwilligung (Art. 6 Abs. 1 lit. a und Art. 7 DSGVO). Was wir brauchen, um Dich anzusetzen und die Aufwandsentschädigung auszuzahlen, sind Name, Schule, Kontaktdaten, Betrag und Geburtsdatum in der Verwaltung der Liga. Rechtsgrundlage dafür ist Deine Tätigkeit für die Liga selbst (Art. 6 Abs. 1 lit. b DSGVO).",
  "Bestätigst Du diese Seite nicht innerhalb von vierzehn Tagen, verfällt der Link; die Verwaltung schickt Dir auf Wunsch einen neuen. Dein Eintrag ist an keine Saison gebunden und bleibt bestehen, solange Du für die Liga Spiele leitest. Du kannst ihn jederzeit selbst löschen.",
  "Du kannst jede Einwilligung jederzeit zurücknehmen (Art. 7 Abs. 3 DSGVO); was bis dahin geschehen ist, bleibt rechtmäßig. Du kannst außerdem jederzeit die Löschung aller Deiner Daten verlangen (Art. 17 DSGVO): direkt in Deinem Zugang über „{loeschung}“ oder mit einer formlosen E-Mail an {kontakt}. Alle Deine Rechte und wie Du sie ausübst, stehen in der {datenschutz}.",
  "dass Du {vorname} bist und diese E-Mail-Adresse Dir gehört,",
  "dass Du von Deinem Eintrag als Schiedsrichterin oder Schiedsrichter weißt und er richtig ist,",
  "dass Du mindestens {minAlter} Jahre alt bist, was wir an dem Geburtsdatum prüfen, das Du hier einträgst,",
  "dass Du in die Veröffentlichung Deines Vornamens und des Anfangsbuchstabens Deines Nachnamens so einwilligst, wie Du es oben gewählt hast, und in Fotos, Videos und Interviews nur, wenn Du den Schalter eingeschaltet hast,",
  "dass Du diese Hinweise und die Datenschutzerklärung lesen konntest.",
] as const;

/**
 * The pupil's confirmation page. Its paragraphs differ from the contact seat's in KIND rather than
 * in nouns: a pupil's record is an Einwilligung, so „Eine Einwilligung ist das nicht“ has no
 * counterpart here.
 */
const SPIELER_ABSAETZE = {
  worum:
    "Du hast Dich über den Link Deines Teams {team} ({schule}) für die Saison {saison} der Frankfurt League registriert. Auf dieser " +
    "Seite bestätigst Du diese Registrierung und entscheidest, was wir mit Deinen Angaben tun dürfen. Erst danach kann Dein Team " +
    "Dich in seinen Kader aufnehmen.",
  gespeichert:
    "Gespeichert sind Dein Vorname, Dein Nachname, Deine E-Mail-Adresse, Deine Rückennummer, Deine Position und Deine Stufe sowie " +
    "das Geburtsdatum, das Du gleich hier einträgst. Deine E-Mail-Adresse ist zugleich Dein Zugang zur Website: Du meldest Dich " +
    "damit ohne Passwort an und siehst dort jederzeit, was wir über Dich gespeichert haben.",
  geburtsdatum:
    "Mitspielen kann nur, wer mindestens {minAlter} Jahre alt ist. Das prüfen wir an dem Geburtsdatum, das Du hier einträgst; " +
    "niemand hat es vorher für Dich angegeben. Ein falsches Geburtsdatum beendet die Teilnahme: Wir schließen den Zugang, und mit " +
    "dieser E-Mail-Adresse ist für fünf volle Saisons keine neue Registrierung möglich.",
  wer:
    "Trainerin oder Trainer, Ansprechperson und Stellvertretung Deines Teams sehen Deinen Namen, " +
    "Deine Nummer, Deine Position und Deine Stufe, entscheiden über die Aufnahme in den Kader und können Nummer, Position, Stufe und die " +
    "Kapitänsrolle anpassen. Deine E-Mail-Adresse und Dein Geburtsdatum sehen nur die Administratorinnen und Administratoren der " +
    "Liga.",
  veroeffentlichung:
    "Du entscheidest, ob Dein Vorname und der Anfangsbuchstabe Deines Nachnamens auf der Website erscheinen: in der Kaderliste " +
    "Deines Teams, in Aufstellungen und bei Torschützen und Karten. Mehr als das steht dort in keinem Fall: nie Dein voller " +
    "Nachname. Wählst Du „intern“, stehen dort nur Deine Nummer und Deine Position, und an der Stelle Deines Namens steht „anonym“. Am " +
    "Mitspielen ändert diese Wahl nichts, und Du kannst sie jederzeit in Deinem Zugang umstellen.",
  medien:
    "Unabhängig davon kannst Du ab {medienMinAlter} Jahren erlauben, dass Fotos, Videos und Interviews, die im Rahmen der Liga " +
    "von Dir entstehen, auf unserer Website und unserem Instagram-Kanal veröffentlicht werden. Bist Du jünger, fragen wir Dich " +
    "das nicht, und wir veröffentlichen keine Fotos oder Videos, auf denen Du zu erkennen bist, und keine Interviews mit Dir. " +
    "Diese Erlaubnis ist " +
    "freiwillig und zunächst ausgeschaltet; ohne sie entsteht Dir kein Nachteil, und auch sie kannst Du jederzeit in Deinem " +
    "Zugang zurücknehmen.",
  rechtsgrundlage:
    "Rechtsgrundlage für die Veröffentlichung Deines Vornamens und des Anfangsbuchstabens Deines Nachnamens und für Fotos, Videos " +
    "und Interviews ist Deine Einwilligung (Art. 6 Abs. 1 lit. a und Art. 7 DSGVO). Was wir zur Durchführung des " +
    "Spielbetriebs brauchen, sind Name, E-Mail-Adresse, Nummer, Position, Stufe und Geburtsdatum in der Verwaltung der " +
    "Liga. Rechtsgrundlage dafür ist unser berechtigtes Interesse, den Spielbetrieb der Liga durchzuführen (Art. 6 Abs. 1 lit. f " +
    "DSGVO).",
  frist:
    "Bestätigst Du diese Seite nicht innerhalb von sieben Tagen, löschen wir die Registrierung von selbst; Du kannst Dich dann " +
    "über den Link Deines Teams erneut registrieren. Deine Angaben behalten wir, bis in der nächsten Saison die Registrierung " +
    "geschlossen ist. Registrierst Du Dich dort wieder mit derselben E-Mail-Adresse, bleiben sie erhalten und Du musst nur Deine " +
    "Wahl bestätigen; andernfalls löschen wir sie dann vollständig.",
  widerruf:
    "Du kannst jede Einwilligung jederzeit zurücknehmen (Art. 7 Abs. 3 DSGVO); was bis dahin geschehen ist, bleibt rechtmäßig. " +
    "Du kannst außerdem jederzeit die Löschung aller Deiner Daten verlangen (Art. 17 DSGVO): direkt in Deinem Zugang über " +
    "„{loeschung}“ oder mit einer formlosen E-Mail an {kontakt}. Alle Deine Rechte und wie Du sie ausübst, stehen in der " +
    "{datenschutz}.",
  // Its own paragraph and never a clause of the one above: Art. 21(4) DSGVO asks the objection to
  // stand apart from every other piece of information. Never keyed `widerspruch`, the glossary's
  // word for a contact seat's decline door.
  art21:
    "Der Verarbeitung für den Spielbetrieb kannst Du jederzeit aus Gründen widersprechen, die sich aus Deiner besonderen Situation " +
    "ergeben (Art. 21 DSGVO).",
  klickIdentitaet: "dass Du {vorname} bist und diese E-Mail-Adresse Dir gehört,",
  klickAlter: "dass Du mindestens {minAlter} Jahre alt bist, was wir an dem Geburtsdatum prüfen, das Du hier einträgst,",
  klickEinwilligung:
    "dass Du in die Veröffentlichung Deines Vornamens und des Anfangsbuchstabens Deines Nachnamens so einwilligst, wie Du es oben " +
    "gewählt hast, und in Fotos, Videos und Interviews nur, wenn Du den Schalter eingeschaltet hast,",
  klickHinweise: "dass Du diese Hinweise und die Datenschutzerklärung lesen konntest.",
} as const;

// A record cites its label alone, and every entry below stands inside the label
// `SCHIEDSRICHTER_EINWILLIGUNG` names, so a polish here rewords what a stored record claims its
// reader saw. Different words mean a new label, never an edit here.
/**
 * The referee confirmation page's standing text. A reader's own facts are `{slots}` for
 * `BESTAETIGUNG_ABSAETZE`'s reason: a record stores those beside the label, so the two together
 * reproduce the screen its person pressed on.
 */
export const SCHIEDSRICHTER_ABSAETZE = {
  worum:
    "Die Verwaltung der Frankfurt League hat Dich als Schiedsrichterin oder Schiedsrichter eingetragen und Dir dafür diesen Link " +
    "geschickt. Auf dieser Seite bestätigst Du den Eintrag und entscheidest, was wir mit Deinen Angaben tun dürfen.",
  gespeichert:
    "Gespeichert sind Dein Name, Deine E-Mail-Adresse und, falls angegeben, Deine Schule und Deine Telefonnummer, das für Dich " +
    "hinterlegte Honorar je Spiel sowie das Geburtsdatum, das Du gleich hier einträgst. Deine E-Mail-Adresse ist " +
    "zugleich Dein Zugang zur Website: Du meldest Dich damit ohne Passwort an, nimmst dort Ansetzungen an oder lehnst sie ab, " +
    "reichst Spielberichte ein und siehst jederzeit, was wir über Dich gespeichert haben.",
  geburtsdatum:
    "Spiele leiten kann nur, wer mindestens {minAlter} Jahre alt ist. Das prüfen wir an dem Geburtsdatum, das Du hier einträgst; " +
    "niemand hat es vorher für Dich angegeben.",
  wer:
    "Deine Schule, Deine Kontaktdaten, das Honorar und Dein Geburtsdatum sehen nur die Administratorinnen und " +
    "Administratoren der Liga. Diese Angaben werden nirgends veröffentlicht und nicht an Teams, Schulen oder Dritte weitergegeben.",
  veroeffentlichung:
    "Du entscheidest, ob Dein Name im Spielplan bei den Spielen erscheint, die Du leitest: der erste Teil Deines Namens und vom " +
    "nächsten nur der Anfangsbuchstabe; ist nur ein Name eingetragen, steht er ganz da. Wählst Du „intern“, steht dort an der " +
    "Stelle Deines Namens „anonym“. Am Leiten von Spielen ändert diese Wahl nichts, und Du kannst sie jederzeit in Deinem Zugang " +
    "umstellen.",
  medien:
    "Unabhängig davon kannst Du ab {medienMinAlter} Jahren erlauben, dass Fotos, Videos und Interviews, die im Rahmen der Liga " +
    "von Dir entstehen, auf unserer Website und unserem Instagram-Kanal veröffentlicht werden. Bist Du jünger, fragen wir Dich " +
    "das nicht, und wir veröffentlichen keine Fotos oder Videos, auf denen Du zu erkennen bist, und keine Interviews mit Dir. " +
    "Diese Erlaubnis ist " +
    "freiwillig und zunächst ausgeschaltet; ohne sie entsteht Dir kein Nachteil, und auch sie kannst Du jederzeit in Deinem " +
    "Zugang zurücknehmen.",
  rechtsgrundlage:
    "Rechtsgrundlage für die Veröffentlichung Deines Namens im Spielplan und für Fotos, Videos " +
    "und Interviews ist Deine Einwilligung (Art. 6 Abs. 1 lit. a und Art. 7 DSGVO). Was wir brauchen, um Dich " +
    "anzusetzen und das Honorar auszuzahlen, sind Name, Kontaktdaten, Betrag und Geburtsdatum, dazu Deine Schule, falls Du " +
    "sie angibst. Rechtsgrundlage dafür ist unser berechtigtes Interesse, den Spielbetrieb der Liga durchzuführen " +
    "(Art. 6 Abs. 1 lit. f DSGVO).",
  frist:
    "Bestätigst Du diese Seite nicht innerhalb von vierzehn Tagen, verfällt der Link; die Verwaltung schickt Dir auf Wunsch einen " +
    "neuen. Dein Eintrag ist an keine Saison gebunden und bleibt bestehen, bis er endgültig gelöscht wird: von Dir selbst, von " +
    "der Verwaltung oder auf Deinen Wunsch. Setzt die Verwaltung Dich nur nicht mehr ein, bleibt er bestehen.",
  widerruf:
    "Du kannst jede Einwilligung jederzeit zurücknehmen (Art. 7 Abs. 3 DSGVO); was bis dahin geschehen ist, bleibt rechtmäßig. " +
    "Du kannst außerdem jederzeit die Löschung aller Deiner Daten verlangen (Art. 17 DSGVO): direkt in Deinem Zugang über " +
    "„{loeschung}“ oder mit einer formlosen E-Mail an {kontakt}. Alle Deine Rechte und wie Du sie ausübst, stehen in der " +
    "{datenschutz}.",
  // Its own paragraph and never a clause of the one above: Art. 21(4) DSGVO asks the objection to
  // stand apart from every other piece of information. Never keyed `widerspruch`, the glossary's
  // word for a contact seat's decline door.
  art21:
    "Der Verarbeitung für den Spielbetrieb kannst Du jederzeit aus Gründen widersprechen, die sich aus Deiner besonderen Situation " +
    "ergeben (Art. 21 DSGVO).",
  klickIdentitaet: "dass Du {vorname} bist und diese E-Mail-Adresse Dir gehört,",
  klickEintrag: "dass Du von Deinem Eintrag als Schiedsrichterin oder Schiedsrichter weißt und er richtig ist,",
  klickAlter: "dass Du mindestens {minAlter} Jahre alt bist, was wir an dem Geburtsdatum prüfen, das Du hier einträgst,",
  klickEinwilligung:
    "dass Du in die Veröffentlichung Deines Namens im Spielplan so einwilligst, wie Du es oben gewählt hast, und in Fotos, Videos " +
    "und Interviews nur, wenn Du den Schalter eingeschaltet hast,",
  klickHinweise: "dass Du diese Hinweise und die Datenschutzerklärung lesen konntest.",
} as const;

/**
 * The media switch's own words, which the label below freezes beside the paragraphs. It is the
 * freiwillig one the contact page's own `schalter` stands for.
 */
export const SCHIEDSRICHTER_MEDIEN_SCHALTER = "Die Liga darf Fotos, Videos und Interviews von mir veröffentlichen.";

// A stored record cites its label alone, so an entry here is never reworded or removed: either
// leaves a record claiming words nobody was shown. Spelling the league's name is not a rewording:
// the stamped words do not move.
export const LIGA_KENNTNISNAHMEN = {
  "2026-08": {
    absaetze: [
      "Ich bin damit einverstanden, dass die Frankfurt League meinen Namen, meine E-Mail-Adresse, meine " +
        "Telefonnummer und mein Geburtsdatum speichert und mich damit zu dieser Saison erreicht, auch über " +
        "WhatsApp. Diese Angaben bleiben in der Verwaltung der Liga und werden nirgends veröffentlicht. Ich " +
        "kann die Einwilligung jederzeit widerrufen.",
    ],
    schalter: "Ja, ich bin einverstanden",
    bedienelemente: {},
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
    bedienelemente: {},
  },
  "2026-09-bestaetigung-2": {
    absaetze: [
      "Die Liga speichert von jeder der drei Personen oben Vorname, Nachname, E-Mail-Adresse und " +
        "Telefonnummer, um das Team während dieser Saison zu erreichen. Diese Angaben bleiben in der " +
        "Verwaltung der Liga und werden nirgends veröffentlicht.",
      "Jede der drei Personen bekommt gleich eine eigene E-Mail mit einem persönlichen Link und bestätigt " +
        "dort selbst, dass die Angaben stimmen. Ihr Geburtsdatum trägt jede dort selbst ein, und daran " +
        "prüfen wir, ob sie mindestens 16 Jahre alt ist; hier im Formular brauchst Du es nicht. Solange " +
        "nicht alle bestätigt haben, bearbeiten wir die Bewerbung nicht; fehlt vierzehn Tage nach dem " +
        "Versand dieser Links noch eine Bestätigung, löschen wir die Bewerbung samt allen Kontaktdaten. " +
        "Ersetzen wir später einen Link durch einen neuen, beginnt diese Frist von vorn. Was wir mit den " +
        "Daten sonst machen und welche Rechte jede dieser Personen hat, steht in der Datenschutzerklärung.",
    ],
    schalter: "Ja, die Angaben stimmen, und die drei Personen wissen von ihrem Eintrag.",
    bedienelemente: {},
  },
  "2026-09-bestaetigung-3": {
    absaetze: [
      "Die Liga speichert von jeder der drei Personen oben Vorname, Nachname, E-Mail-Adresse und " +
        "Telefonnummer, um das Team während dieser Saison zu erreichen. Diese Angaben bleiben in der " +
        "Verwaltung der Liga und werden nirgends veröffentlicht.",
      "Jede der drei Personen bekommt gleich eine eigene E-Mail mit einem persönlichen Link und bestätigt " +
        "dort selbst, dass die Angaben stimmen. Ihr Geburtsdatum trägt jede dort selbst ein, und daran " +
        "prüfen wir, ob sie mindestens 16 Jahre alt ist; hier im Formular brauchst Du es nicht. Solange " +
        "nicht alle bestätigt haben, bearbeiten wir die Bewerbung nicht; fehlt vierzehn Tage nach dem " +
        "Versand dieser Links noch eine Bestätigung, löschen wir die Bewerbung samt allen Kontaktdaten. " +
        "Ersetzen wir später einen Link durch einen neuen, beginnt diese Frist für die ganze Bewerbung " +
        "von vorn; eine Erinnerung verschiebt sie nicht. Was wir mit den Daten sonst machen und welche " +
        "Rechte jede dieser Personen hat, steht in der Datenschutzerklärung.",
    ],
    schalter: "Ja, die Angaben stimmen, und die drei Personen wissen von ihrem Eintrag.",
    bedienelemente: {},
  },
  // A label of its own because the words moved: every record already stamped keeps the ones it was
  // given. The floors stand in the form beside this text rather than inside it, so raising one
  // re-versions nothing.
  "2026-09-bestaetigung-4": {
    absaetze: [
      "Die Liga speichert von jeder der drei Personen oben Vorname, Nachname, E-Mail-Adresse und " +
        "Telefonnummer, um das Team während dieser Saison zu erreichen. Diese Angaben bleiben in der " +
        "Verwaltung der Liga und werden nirgends veröffentlicht.",
      "Jede der drei Personen bekommt gleich eine eigene E-Mail mit einem persönlichen Link und bestätigt " +
        "dort selbst, dass die Angaben stimmen. Ihr Geburtsdatum trägt jede dort selbst ein, und daran " +
        "prüfen wir, ob sie das Mindestalter ihrer Rolle erreicht; hier im Formular brauchst Du es nicht. " +
        "Solange nicht alle bestätigt haben, bearbeiten wir die Bewerbung nicht; fehlt vierzehn Tage nach dem " +
        "Versand dieser Links noch eine Bestätigung, löschen wir die Bewerbung samt allen Kontaktdaten. " +
        "Ersetzen wir später einen Link durch einen neuen, beginnt diese Frist für die ganze Bewerbung " +
        "von vorn; eine Erinnerung verschiebt sie nicht. Was wir mit den Daten sonst machen und welche " +
        "Rechte jede dieser Personen hat, steht in der Datenschutzerklärung.",
    ],
    schalter: "Ja, die Angaben stimmen, und die drei Personen wissen von ihrem Eintrag.",
    bedienelemente: {},
  },
  // The form is the submitting Ansprechperson's first contact, so Art. 21(4) DSGVO asks the
  // objection here, in a paragraph of its own; the words moved, so the label did.
  "2026-09-bestaetigung-5": {
    absaetze: [
      "Die Liga speichert von jeder der drei Personen oben Vorname, Nachname, E-Mail-Adresse und " +
        "Telefonnummer, um das Team während dieser Saison zu erreichen. Diese Angaben bleiben in der " +
        "Verwaltung der Liga und werden nirgends veröffentlicht.",
      "Jede der drei Personen bekommt gleich eine eigene E-Mail mit einem persönlichen Link und bestätigt " +
        "dort selbst, dass die Angaben stimmen. Ihr Geburtsdatum trägt jede dort selbst ein, und daran " +
        "prüfen wir, ob sie das Mindestalter ihrer Rolle erreicht; hier im Formular brauchst Du es nicht. " +
        "Solange nicht alle bestätigt haben, bearbeiten wir die Bewerbung nicht; fehlt vierzehn Tage nach dem " +
        "Versand dieser Links noch eine Bestätigung, löschen wir die Bewerbung samt allen Kontaktdaten. " +
        "Ersetzen wir später einen Link durch einen neuen, beginnt diese Frist für die ganze Bewerbung " +
        "von vorn; eine Erinnerung verschiebt sie nicht. Was wir mit den Daten sonst machen und welche " +
        "Rechte jede dieser Personen hat, steht in der Datenschutzerklärung.",
      "Der Verarbeitung Deiner Angaben kannst Du jederzeit aus Gründen widersprechen, die sich aus Deiner " +
        "besonderen Situation ergeben (Art. 21 DSGVO).",
    ],
    schalter: "Ja, die Angaben stimmen, und die drei Personen wissen von ihrem Eintrag.",
    bedienelemente: {},
  },
  // A label of its own, never a second block in the entry above: that entry is stamped on the
  // applicant's and the admin editor's records, and neither reader saw a word of the page below.
  "2026-09-bestaetigungsseite": {
    absaetze: BESTAETIGUNGSSEITE_ABSAETZE_2026_09,
    schalter: "Die Liga darf mich auch über WhatsApp erreichen.",
    bedienelemente: {},
  },
  "2026-09-bestaetigungsseite-2": {
    absaetze: BESTAETIGUNGSSEITE_ABSAETZE_2026_09_2,
    schalter: "Die Liga darf mich auch über WhatsApp erreichen.",
    bedienelemente: {},
  },
  "2026-09-bestaetigungsseite-3": {
    absaetze: BESTAETIGUNGSSEITE_ABSAETZE_2026_09_3,
    schalter: "Die Liga darf mich auch über WhatsApp erreichen.",
    bedienelemente: {},
  },
  "2026-09-bestaetigungsseite-4": {
    absaetze: BESTAETIGUNGSSEITE_ABSAETZE_2026_09_4,
    schalter: "Die Liga darf mich auch über WhatsApp erreichen.",
    bedienelemente: {},
  },
  // A label of its own because the words moved: every record already stamped keeps the ones it
  // was given.
  "2026-09-bestaetigungsseite-5": {
    absaetze: BESTAETIGUNGSSEITE_ABSAETZE_2026_09_5,
    schalter: "Die Liga darf mich auch über WhatsApp erreichen.",
    bedienelemente: {},
  },
  "2026-09-bestaetigungsseite-6": {
    absaetze: Object.values(BESTAETIGUNG_ABSAETZE),
    schalter: "Die Liga darf mich auch über WhatsApp erreichen.",
    bedienelemente: {},
  },
  // The referee's page, under a label of its own: the paragraphs below are a different page's, and
  // a record stamped here cites words no contact person and no pupil was shown.
  "2026-09-schiedsrichterseite": {
    absaetze: SCHIEDSRICHTERSEITE_ABSAETZE_2026_09,
    schalter: SCHIEDSRICHTER_MEDIEN_SCHALTER,
    bedienelemente: {
      kader_oeffentlich: "Vorname und erster Buchstabe des Nachnamens",
      intern: "Intern: dort steht „anonym“",
    },
  },
  "2026-09-schiedsrichterseite-2": {
    absaetze: Object.values(SCHIEDSRICHTER_ABSAETZE),
    schalter: SCHIEDSRICHTER_MEDIEN_SCHALTER,
    bedienelemente: {
      // A referee's name is one field, so the chip names its parts rather than a forename and a
      // surname the stored row may not hold.
      kader_oeffentlich: "Erster Namensteil und Anfangsbuchstabe des nächsten",
      intern: "Intern: dort steht „anonym“",
    },
  },
  // A label of its own, never a paragraph added to the entries above: a pupil's record is a consent
  // and a contact seat's is not, so no reader of one ever saw a word of the other.
  "2026-09-spielerseite": {
    absaetze: SPIELERSEITE_ABSAETZE_2026_09,
    schalter: "Die Liga darf Fotos, Videos und Interviews von mir veröffentlichen.",
    bedienelemente: {
      kader_oeffentlich: "Vorname und erster Buchstabe des Nachnamens",
      intern: "Intern: nur Nummer und Position, ohne Namen",
    },
  },
  "2026-09-spielerseite-2": {
    absaetze: Object.values(SPIELER_ABSAETZE),
    schalter: "Die Liga darf Fotos, Videos und Interviews von mir veröffentlichen.",
    bedienelemente: {
      kader_oeffentlich: "Vorname und erster Buchstabe des Nachnamens",
      intern: "Intern: nur Nummer und Position, ohne Namen",
    },
  },
} as const satisfies Readonly<Record<string, EinwilligungFassung>>;

const AKTUELLE_FASSUNG = "2026-09-bestaetigung-5";
const AKTUELLE_BESTAETIGUNG = "2026-09-bestaetigungsseite-6";
const AKTUELLE_SPIELERSEITE = "2026-09-spielerseite-2";
const AKTUELLE_SCHIEDSRICHTERSEITE = "2026-09-schiedsrichterseite-2";

// Read off the record rather than spelled again, so a new wording and the bump that names it cannot
// land in separate edits.
export const LIGA_KENNTNISNAHME = {
  textVersion: AKTUELLE_FASSUNG,
  ...LIGA_KENNTNISNAHMEN[AKTUELLE_FASSUNG],
} as const;

/** The confirming person's own wording and label, read off the record for `LIGA_KENNTNISNAHME`'s reason. */
export const BESTAETIGUNG_KENNTNISNAHME = {
  textVersion: AKTUELLE_BESTAETIGUNG,
  ...LIGA_KENNTNISNAHMEN[AKTUELLE_BESTAETIGUNG],
} as const;

// `absaetzeNachSchluessel` beside the frozen array, because a page places its sections by key and
// the label freezes them by position. A rewording that froze a copy and left the keyed object
// standing reaches `einwilligung.test.ts`'s equality rather than the live page.
/** The registering pupil's own wording and label, read off the record for `LIGA_KENNTNISNAHME`'s reason. */
export const SPIELER_EINWILLIGUNG = {
  textVersion: AKTUELLE_SPIELERSEITE,
  ...LIGA_KENNTNISNAHMEN[AKTUELLE_SPIELERSEITE],
  absaetzeNachSchluessel: SPIELER_ABSAETZE,
} as const;

/** The confirming referee's own wording and label, read off the record for `LIGA_KENNTNISNAHME`'s reason. */
export const SCHIEDSRICHTER_EINWILLIGUNG = {
  textVersion: AKTUELLE_SCHIEDSRICHTERSEITE,
  ...LIGA_KENNTNISNAHMEN[AKTUELLE_SCHIEDSRICHTERSEITE],
  absaetzeNachSchluessel: SCHIEDSRICHTER_ABSAETZE,
} as const;

/**
 * Answers the words a stored label cites, and never a fallback: the current wording under an old
 * label is a record claiming acknowledgement of a text its person never read.
 */
export function einwilligungFassung(textVersion: string): EinwilligungFassung | null {
  const fassungen: Readonly<Record<string, EinwilligungFassung>> = LIGA_KENNTNISNAHMEN;

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
