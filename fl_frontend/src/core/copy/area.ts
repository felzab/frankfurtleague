import { catalogue, lineOf, seatsText, textOf } from "../copy";
import { formatNumber } from "../format";
import { COPY } from "./shared";

import type { Copy, TextLink, Words } from "../copy";
import type { FLCardColour, FLKontaktSeat, FLSonderereignis } from "../generated/client/types";

/**
 * The words a client component under `/area` reads, for a team's contact seats, a pupil and a referee. What another
 * area reads too stands in `COPY.shared` or its noun's section, and what only a server page reads in `SERVER_COPY.area`.
 */
export const AREA_COPY = catalogue({
  spieler: {
    lineupPlace: { starts: "In der Startelf", bench: "Auf der Bank" },
  },

  team: {
    accountLine: (shorthand: Words, seats: readonly FLKontaktSeat[]) => lineOf([textOf(shorthand), seatsText(seats)]),
    /**
     * What the league decides: the decline dialog's one sentence, a proposal moving nothing until the league saves a
     * date; and the last part of an expired date's line on the Übersicht, which takes no answer past its deadline. A
     * declined row's line ends on the team's proposal.
     */
    declineConsequence: "Über den Termin entscheidet die Liga.",
    leagueDecides: "Die Liga entscheidet",

    registrierung: {
      search: COPY.shared.search(COPY.page.registrierungen),
      /**
       * The muted line under an empty list of those the link brings, the registrations and the Kader, around the
       * league's address, which the page sets as its link: only the league mints and mails a team's link.
       */
      linkFromLeague: (league: TextLink<Words>) => ["Den Registrierungslink schickt die Liga, erreichbar unter ", league, "."] as const,
      /** The registration's address is a stored person's. */
      returning: "War schon in der Liga",
      /** Why „Aufnehmen“ is locked: the squad is at its cap, or the pupil's own link is unanswered. */
      kaderFull: "Kader voll",
      declineConsequence: "Die Person kommt nicht in den Kader.",
      /**
       * The admission of a registration whose address is a stored person's under other details: the line under the
       * dialog's title names that person, and the two choices say whose registration it is. A contact seat is served
       * no address, so the line names the person alone.
       */
      earlierEntry: (name: Words) => `Ein früherer Eintrag nennt ${textOf(name)}.`,
      admitAs: (name: Words) => `Als ${textOf(name)} aufnehmen`,
      otherPerson: "Andere Person, ablehnen",
    },
  },

  schiedsrichter: {
    /** A game the referee is booked onto, as their Übersicht lists it: the glossary's `Einsatz`, not the mail telling them. */
    einsatz: "Einsatz",
    /** A game's chip on the referee's list once their report is stored, apart from the action log's entry of the same words. */
    reported: "Spielbericht eingetragen",

    /** The match report's form; a goal's and a result's words are `spielplan`'s. */
    spielbericht: {
      /** The played minute, and stoppage time after a plus. */
      minuteExample: "90+3",
      cards: "Karten",
      card: "Karte",
      colour: { gelb: "Gelb", gelb_rot: "Gelb-Rot", rot: "Rot" } satisfies Record<FLCardColour, string>,
      remarks: "Bemerkungen",
      /** A goal's or a card's row, counting the rows from 1. */
      numbered: (noun: Copy, number: number) => `${noun} ${formatNumber(number)}`,
      /** The status card of a match called off or struck out, which takes no report. */
      befell: { ausgefallen: "Spiel ausgefallen", annulliert: "Spiel annulliert" } satisfies Partial<Record<FLSonderereignis, string>>,
    },
  },
});
