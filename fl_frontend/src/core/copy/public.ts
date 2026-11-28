import { boundBy, catalogue, spieltagName } from "../copy";
import { formatNumber } from "../format";
import { COPY } from "./shared";

import type { RecordText, TextLink } from "../copy";

const SIGN_IN_WITH_PASSKEY = "Mit Passkey anmelden";
// Konto's set-up composes the same words, so one act reads one label on both pages.
const SET_UP_PASSKEY = COPY.shared.withObject(COPY.shared.passkey, "setUp");
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
    /** Under a seat's first name: the youngest age the write takes for whoever holds the seat. */
    seatFloor: (age: number) => `Ab ${boundBy(formatNumber(age), "Jahren")}`,
    seatCovered: "Übernimmt die Trainerin oder der Trainer.",
    /** A promise the form makes, which the privacy record states. */
    addressPublic: "Steht nach der Zusage öffentlich auf der Teamseite",
    trikotSetDescription: "Zum Beispiel 15\u00A0rote Trikots",
    goodSpielerDescription: "Aktiv, mindestens Verbandsliga",
    wunschgegnerDescription: `Für den ${spieltagName(1)}`,
    /** The sentence above the submit, around the privacy notice's link. */
    notice: (link: TextLink) => ["Jede Kontaktperson bestätigt ihren Eintrag per E-Mail, mehr unter ", link, "."] as const,
  },

  /** The public registration form's own words; its squad fields read the labels `kader` gives them. */
  registrierung: {
    box: "Deine Angaben",
    /** Under the address: the confirmation link goes there, and one address signs one person in. */
    ownAddress: "Deine eigene Adresse",
    /** The number box's label, the shirt's own word, which a pupil reads where the squad's lists say „Nummer“. */
    nummer: "Trikotnummer",
    /** The sentence above the submit, around the privacy notice's link, as `bewerbung.notice`. */
    notice: (link: TextLink) => ["Du bestätigst deine Registrierung per E-Mail, mehr unter ", link, "."] as const,
  },

  signIn: {
    sendCode: "Code senden",
    or: "oder",
    withPasskey: SIGN_IN_WITH_PASSKEY,

    /**
     * The code view: one sentence for every address, so it says nothing about who holds an account, around the
     * address, which the template sets semibold.
     */
    inbox: "Prüfe dein Postfach",
    codeOnItsWay: (address: RecordText) => ["Falls zu ", address, " ein Konto gehört, ist ein Anmeldecode unterwegs."] as const,
    /** The six boxes' accessible name: no label stands above them. */
    code: "Code aus der E-Mail",
    otherAddress: "Andere E-Mail-Adresse verwenden",

    /** The passkey step's card: its button repeats its title, as Konto's set-up names the same act. */
    passkey: {
      setUp: { title: SET_UP_PASSKEY, sentence: PASSKEY_REQUIRED, button: SET_UP_PASSKEY },
      signIn: { title: SIGN_IN_WITH_PASSKEY, sentence: PASSKEY_REQUIRED, button: SIGN_IN_WITH_PASSKEY },
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
    },
  },

  /** The landing's words a client component reads; the rest stand in `SERVER_COPY.landing`. */
  landing: {
    saison: { days: "Tage", hours: "Stunden", minutes: "Minuten" },
  },
});
