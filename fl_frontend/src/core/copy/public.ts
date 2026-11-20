import { catalogue, PASSKEY_WITHOUT_CODE, spieltagName, VERB } from "../copy";

const SIGN_IN_WITH_PASSKEY = "Mit Passkey anmelden";
const SET_UP_PASSKEY = { title: "Passkey einrichten", button: "Jetzt einrichten" } as const;
const PASSKEY_REQUIRED = "Die Verwaltung ist erst mit einem Passkey erreichbar.";

/** The words of the public forms, the sign-in and the landing, which a visitor reads. */
export const PUBLIC_COPY = catalogue({
  /** The public application form's own words; what the administration names alike stands in `team`. */
  bewerbung: {
    schoolDescription: "Die Schulen, die schon mitgespielt haben",
    schoolNotListed: "Meine Schule ist nicht in der Liste",
    teamNameDescription: "Kurz, wie das Team genannt wird",
    stufengroesseDescription: "Wie viele im Abi-Jahrgang sind",
    /** Each seat confirms for one person, which a shared inbox would let one person do for two. */
    ownAddress: "Die eigene Adresse der Person",
    seatCovered: "Übernimmt die Trainerin oder der Trainer.",
    /** A promise the form makes, which the privacy record states. */
    addressPublic: "Steht nach der Zusage öffentlich auf der Teamseite",
    trikotSetDescription: "Zum Beispiel 15\u00A0rote Trikots",
    goodSpielerDescription: "Aktiv, mindestens Verbandsliga",
    wunschgegnerDescription: `Für den ${spieltagName(1)}`,
    suggestions: "Vorschläge anzeigen",
    /**
     * The sentence above the submit, in the two parts around the privacy notice's title, which the form sets as its
     * link.
     */
    notice: { before: "Jede Kontaktperson bestätigt ihren Eintrag per E-Mail, mehr unter\u00A0", after: "." },
  },

  /** The public registration form's own words; its squad fields read the labels `kader` gives them. */
  registrierung: {
    box: "Deine Angaben",
    /** Under the address: the confirmation link goes there, and one address signs one person in. */
    ownAddress: "Deine eigene Adresse",
    /** The number box's label, the shirt's own word, which a pupil reads where the squad's lists say „Nummer“. */
    nummer: "Trikotnummer",
    /** The sentence above the submit, in the two parts around the privacy notice's title, as `bewerbung.notice`. */
    notice: { before: "Du bestätigst deine Registrierung per E-Mail, mehr unter\u00A0", after: "." },
  },

  signIn: {
    title: VERB.signIn,

    sendCode: "Code senden",
    or: "oder",
    withPasskey: SIGN_IN_WITH_PASSKEY,

    /**
     * The code view: one sentence for every address, so it says nothing about who holds an account, in the two
     * parts around the address, which the template sets semibold between them.
     */
    inbox: "Prüfe dein Postfach",
    codeOnItsWay: { before: "Falls zu", after: "ein Konto gehört, ist ein Anmeldecode unterwegs." },
    /** The six boxes' accessible name: no label stands above them. */
    code: "Code aus der E-Mail",
    otherAddress: "Andere E-Mail-Adresse verwenden",

    passkey: {
      setUp: { ...SET_UP_PASSKEY, sentence: PASSKEY_REQUIRED },
      signIn: { title: SIGN_IN_WITH_PASSKEY, sentence: PASSKEY_REQUIRED, button: "Jetzt anmelden" },
      offer: { ...SET_UP_PASSKEY, sentence: PASSKEY_WITHOUT_CODE },
      later: "Später",
    },

    /**
     * The code's and the passkey's refusals, which the page words off the sign-in library's own codes. A barred
     * address and one holding no record meet one sentence, so nobody can probe the ban list.
     * The typed code's own refusal is a phrase under its boxes, a wrong code and one no longer valid alike; every other
     * is a sentence on the status line.
     */
    refusal: {
      codeWrong: "Falsch oder nicht mehr gültig",
      noRecord: "Mit dieser Adresse ist keine Anmeldung möglich.",
      unverified: "Dieser Passkey hat nicht bestätigt, dass du es bist.",
    },
  },

  /** The landing's words a client component reads; the rest stand in `SERVER_COPY.landing`. */
  landing: {
    saison: { days: "Tage", hours: "Stunden", minutes: "Minuten" },
  },
});
