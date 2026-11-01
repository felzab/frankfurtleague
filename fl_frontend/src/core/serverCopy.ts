import "server-only";

import { catalogue, COPY } from "./copy";
import { formatNumber } from "./format";

import type { Code } from "./generated/client/types";

// One rule over two codes: a match whose result no play decides carries no goals, on the fixture and in its report.
const NO_TORE = "Nur ohne eingetragene Tore";

/**
 * The catalogue's entries only the server reads, so no client bundle carries them: `COPY` is one object, and a
 * bundler keeps all of an object a client module imports. Branded as `COPY` is, so an entry passes wherever a `Copy`
 * is asked for.
 */
export const SERVER_COPY = catalogue({
  /**
   * A refusal's own phrase, by the backend's code, for a code a person causes knowingly from a screen; every other
   * code answers one of the shared failure lines `COPY.shared.failure` holds. A refusal about one field shows on it,
   * in the field patterns' form, or, where the screen shows no box for it, on the status line after the field's name.
   */
  refusal: {
    duplicate_key: COPY.shared.field.taken,
    spiel_outside_spieltag: "Außerhalb des Spieltags",
    state_ergebnis_on_a_non_event: NO_TORE,
    state_nichtantreten_without_two_sides: "Nur mit beiden Teams",
    booking_unknown_resource: "Stillgelegt oder gelöscht",
    booking_unconfirmed_schiedsrichter: "Noch nicht bestätigt",
    spiel_double_booked: "Zu dieser Zeit schon eingeteilt",
    eligibility_disqualified: "Aus der Saison ausgeschieden",
  } satisfies Partial<Record<Code, string>>,

  /**
   * A rule's own phrase, in the field patterns' form, by the kind the backend refuses a payload with
   * (`fields[].kind`), for a rule a person can break that no field pattern words: placed as `refusal` places a code.
   * Every other rule is worded from the patterns by `fl_frontend/src/core/ruleMessage.ts :: ruleMessage`.
   */
  rule: {
    elfmeterschiessen_without_winner: "Nur mit Sieger",
    nichtantreten_with_tore: NO_TORE,
    nichtantreten_with_torschuetzen: "Nur ohne Torschützen",
    elfmeterschiessen_without_draw: "Nur nach Unentschieden",
    torschuetzen_not_matching_tore: "Ein Eintrag je Tor",
  },

  /** The mail shell's own lines; each mail's sentences are its template's until its area's session rewrites them. */
  mail: {
    /** The one greeting: the first name where it is known. */
    greeting: (vorname: string) => (vorname === "" ? "Hallo," : `Hallo ${vorname},`),
    /** Under the button, above its link printed to copy. */
    buttonLink: "Falls der Knopf nicht geht, öffne diesen Link:",
    /**
     * The Art. 21 DSGVO objection, set apart from the rest as Art. 21 (4) asks, in the two parts around the league's
     * address, which the shell sets as a link between them.
     */
    objection: {
      before:
        "Du kannst der Verarbeitung deiner Angaben jederzeit widersprechen, aus Gründen, die sich aus deiner besonderen Situation ergeben (Art. 21 DSGVO). Eine formlose E-Mail an",
      after: "genügt.",
    },
    /** The mail's last line, by its kind: what a reader the mail was not meant for does. */
    notYou: {
      signIn: "Du hast keinen Code angefordert? Dann ignoriere diese E-Mail.",
      security: "Warst du das nicht? Dann antworte sofort auf diese E-Mail.",
      firstContact: "Du weißt nichts davon? Dann antworte auf diese E-Mail, und wir löschen deine Angaben.",
    },
  },

  /** The kit's season blocks, drawn on the server alone: the Tabelle's groups and the K.-o.-Baum's rows. */
  season: {
    /** One group's table on the Tabelle. */
    gruppe: (gruppe: string) => `Gruppe ${gruppe}`,
    /** The match between the two semi-finals' losers, on its own row above the Finale. */
    thirdPlace: "Spiel um Platz 3",
    /** Where a club stands, under its name in a match head, linking to its row on the Tabelle. */
    standing: (platz: number, gruppe: string) => `${formatNumber(platz)}. Platz · Gruppe ${gruppe}`,
  },
});
