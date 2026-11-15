import { COPY } from "@/core/copy";

import type { Copy } from "@/core/copy";
import type { ChipProps } from "./Chip";

/*
 * The states several pages draw, each one word in one hue wherever it stands, so no page decides its own chip for a
 * state another page shows too. Green is a state reached and in order, as a list's default row is. A state waiting on a
 * person or a press draws amber while one can still follow it, and grey, as a thing out of play, where none can: a
 * finished season's links.
 */

/** A record in play, the default of a list's „Stand“ column and of its editor's head: a club, a squad row, a venue. */
export const ACTIVE_CHIP: ChipProps = { tone: "success", label: COPY.admin.team.active };

/** A record the league retired, out of play for every season to come: a club, a venue, a referee. */
export const RETIRED_CHIP: ChipProps = { tone: "neutral", label: COPY.shared.retired };

/** A person who confirmed their entry: a seat, a registration, a referee. */
export const CONFIRMED_CHIP: ChipProps = { tone: "success", label: COPY.admin.confirmed };

/** A person whose entry waits on their confirmation, asked or not yet: the same seats, registrations and referees. */
export const UNCONFIRMED_CHIP: ChipProps = { tone: "warn", label: COPY.admin.schiedsrichter.unconfirmed };

/** A person who objected through their own link, the entry going with it: a seat, a referee. */
export const OBJECTED_CHIP: ChipProps = { tone: "danger", label: COPY.admin.objected };

/** A seat an erasure emptied, its person's data gone. */
export const ERASED_CHIP: ChipProps = { tone: "neutral", label: COPY.admin.erased };

/**
 * What lapsed unanswered past its deadline, which no answer reaches now: a date asked of a club or a referee, a seat's
 * link, a step of an address change. Grey, as a thing out of play: nobody can act on it but the league.
 */
export const EXPIRED_CHIP: ChipProps = { tone: "neutral", label: COPY.admin.expired };

/**
 * Something a club or a referee still owes on a match and can still give, in the catalogue's words for what is missing:
 * an answer to its date, a line-up, a report. The words are the pattern's and the hue is this one, so neither is a
 * page's to decide.
 */
export const owedChip = (missing: Copy): ChipProps => ({ tone: "warn", label: missing });

/** A date a club or a referee agreed to. */
export const AGREED_CHIP: ChipProps = { tone: "success", label: COPY.admin.spiel.agreed };

/**
 * A final no: a date a club or a referee declined, and an application the league declined. Red, as every answer that
 * ends what it was asked about.
 */
export const DECLINED_CHIP: ChipProps = { tone: "danger", label: COPY.admin.spiel.declined };

/** A squad row registered after the season's window closed, which holds for the season: a squad row, a line-up's player. */
export const NOMINEE_CHIP: ChipProps = { tone: "info", label: COPY.admin.spieler.nominee };

/**
 * A link whose mail never went out, waiting on a press: a club's registration link before the season's press reaches
 * it, and the link of an application's seat or of a registration held back while its mailbox holds too many unanswered
 * ones, on its page and on its list's row.
 */
export const NOT_SENT_CHIP: ChipProps = { tone: "warn", label: COPY.admin.saison.linkNotSent };

/** A waiting state that nobody can follow any more, as a finished season's link: its own word, grey as out of play. */
export const outOfPlayChip = (waiting: ChipProps): ChipProps => ({ ...waiting, tone: "neutral" });

/** A club's registration link the season's press mailed, the other side of `NOT_SENT_CHIP` in the season's links. */
export const SENT_CHIP: ChipProps = { tone: "success", label: COPY.admin.saison.linkSent };
