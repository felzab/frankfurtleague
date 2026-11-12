import { COPY } from "@/core/copy";

import type { ChipProps } from "./Chip";

/*
 * The states several pages draw, each one word in one hue wherever it stands, so no page decides its own chip for a
 * state another page shows too. Green is a state reached and in order, as a list's default row is.
 */

/** A record in play, the default row of a list's „Stand“ column: a club, a squad row, a venue. */
export const ACTIVE_CHIP: ChipProps = { tone: "success", label: COPY.admin.team.active };

/** A person who confirmed their entry: a seat, a registration, a referee. */
export const CONFIRMED_CHIP: ChipProps = { tone: "success", label: COPY.admin.confirmed };
