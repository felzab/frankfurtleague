import "server-only";

import { COPY, katalog } from "./copy";

import type { Code } from "./generated/client/types";

/**
 * The catalogue's entries only the server reads, so no client bundle carries them: `COPY` is one object, and a
 * bundler keeps all of an object a client module imports. Branded as `COPY` is, so an entry passes wherever a `Copy`
 * is asked for.
 */
export const SERVER_COPY = katalog({
  /**
   * A refusal's own words, by the backend's code, for a code a person causes knowingly from a screen; every other
   * code answers one of the shared failure lines `COPY.shared.fehler` holds. A form places a code on the field it
   * names, where the words are a field's phrase; anywhere else they are the status line's reason and its repair.
   */
  ablehnung: {
    duplicate_key: COPY.shared.feld.schonVergeben,
    spiel_outside_spieltag: "Außerhalb des Spieltags",
    state_ergebnis_on_a_non_event: "Nur ohne eingetragene Tore",
    state_nichtantreten_without_two_sides: "Nur mit beiden Teams",
    booking_unknown_resource:
      "Spielort oder Schiedsrichter ist stillgelegt oder gelöscht und kann keinem Spiel neu zugeteilt werden, auch keinem, dessen Absage oder Ergebnis du gerade entfernst. Wähle einen anderen, oder reaktiviere den Eintrag, falls er nur stillgelegt ist.",
    booking_unconfirmed_schiedsrichter:
      "Diese Schiedsrichterin oder dieser Schiedsrichter hat den eigenen Eintrag noch nicht bestätigt. Teile jemand anderen ein, oder warte auf die Bestätigung.",
    spiel_double_booked:
      "Spielort oder Schiedsrichter ist zu dieser Zeit schon für ein anderes Spiel eingeteilt. Wähle eine Uhrzeit mit mindestens vier Stunden Abstand, oder teile das Spiel anders ein.",
    eligibility_disqualified:
      "Dieses Team ist aus der Saison ausgeschieden und darf ab seinem Austritt nicht mehr aufgestellt sein. Wähle einen Tag vor dem Austritt oder ein anderes Team.",
  } satisfies Partial<Record<Code, string>>,

  /**
   * A rule's own words, by the kind the backend refuses a payload with (`fields[].kind`), for a rule its published
   * schema cannot carry and a person can break: placed as `ablehnung` places a code. A field's rule is a field's
   * phrase; a rule over several fields is its reason and its repair.
   */
  regel: {
    saison_year_out_of_range: "Ein Jahr von 2026 bis zum nächsten Jahr",
    address_in_free_text: "Ohne E-Mail-Adresse",
    email_not_accepted: "Eine Adresse ohne Umlaute oder Akzente vor dem @",
    date_not_in_calendar: "Ein Datum, das es im Kalender gibt",
    url_not_accepted: "Eine Webadresse, die mit http:// oder https:// beginnt",
    saison_ends_before_start: "Die Saison endet vor ihrem Beginn. Wähle ein Ende nach dem Beginn.",
    bewerbung_window_ends_before_start: "Die Bewerbungsfrist endet vor ihrem Beginn. Wähle ein Ende nach dem Beginn.",
    registrierung_window_ends_before_start: "Die Registrierungsfrist endet vor ihrem Beginn. Wähle ein Ende nach dem Beginn.",
    spieltag_ends_before_start: "Der Spieltag endet vor seinem Beginn. Wähle ein Ende nach dem Beginn.",
    gute_spieler_exceed_kader:
      "Es sind mehr gute Spieler angegeben, als der Kader voraussichtlich Spieler hat. Gib höchstens so viele an wie die voraussichtliche Kadergröße.",
    kontakt_email_twice: "Zwei Kontaktpersonen haben dieselbe E-Mail-Adresse. Gib jeder Person ihre eigene.",
    kontakt_telefon_twice: "Zwei Kontaktpersonen haben dieselbe Telefonnummer. Gib jeder Person ihre eigene.",
    elfmeterschiessen_without_winner: "Ein Elfmeterschießen endet nicht unentschieden. Trag für eine Seite mehr Treffer ein.",
    nichtantreten_with_tore: "Bei einem Nichtantreten stehen keine Tore im Bericht, das Ergebnis setzt die Liga. Lösche die Tore.",
    nichtantreten_with_torschuetzen: "Bei einem Nichtantreten gibt es keine Torschützen. Lösche die Einträge.",
    ergebnis_missing_tore: "Zum Ergebnis gehören die Tore beider Teams. Trag sie für beide Teams ein.",
    elfmeterschiessen_without_draw: "Ein Elfmeterschießen folgt nur auf ein Unentschieden. Lösche es, oder trag ein Unentschieden ein.",
    torschuetzen_not_matching_tore: "Die Torschützen ergeben ein anderes Ergebnis als die Tore. Trag für jedes Tor genau einen Eintrag ein.",
    decline_without_proposal: "Wer absagt, schlägt einen anderen Termin vor. Wähle einen Termin.",
    decline_without_reason: "Wer absagt, nennt einen Grund. Schreib kurz, warum.",
  },

  /** The mail shell's own lines; each mail's sentences are its template's until its area's session rewrites them. */
  mail: {
    /** The one greeting: the first name where it is known. */
    gruss: (vorname: string) => (vorname === "" ? "Hallo," : `Hallo ${vorname},`),
    /** Under the button, above its link printed to copy. */
    knopfLink: "Falls der Knopf nicht geht, öffne diesen Link:",
    /**
     * The Art. 21 DSGVO objection, set apart from the rest as Art. 21 (4) asks, in the two parts around the league's
     * address, which the shell sets as a link between them.
     */
    widerspruch: {
      vor: "Du kannst der Verarbeitung deiner Angaben jederzeit widersprechen, aus Gründen, die sich aus deiner besonderen Situation ergeben (Art. 21 DSGVO). Eine formlose E-Mail an",
      nach: "genügt.",
    },
    /** The mail's last line, by its kind: what a reader the mail was not meant for does. */
    nichtDu: {
      anmeldung: "Du hast keinen Code angefordert? Dann ignoriere diese E-Mail.",
      sicherheit: "Warst du das nicht? Dann antworte sofort auf diese E-Mail.",
      erstkontakt: "Du weißt nichts davon? Dann antworte auf diese E-Mail, und wir löschen deine Angaben.",
    },
  },
});
