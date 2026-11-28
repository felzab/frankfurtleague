import { COPY } from "@/core/copy/shared";
import { SERVER_COPY } from "@/core/serverCopy";
import { rolleMarkOf, shirtNumber, spielerName } from "@/features/spieler/constants";
import { NOMINEE_CHIP } from "@/kit/stateChips";

import { STARTERS_MAX } from "./constants";

import type { FLAufstellungResponse, FLAufstellungSpieler } from "@/core/generated/client/types";
import type { ChipProps } from "@/kit/Chip";
import type { LineupPlayer, LineupWords } from "@/kit/Lineup";

export const LINEUP_WORDS: LineupWords = {
  picked: SERVER_COPY.season.spiel.aufstellung,
  rest: COPY.aufstellung.rest,
  name: SERVER_COPY.season.column.name,
  nummer: SERVER_COPY.season.column.nummer,
  position: SERVER_COPY.season.column.position,
  starts: COPY.shared.startelf,
  pick: COPY.shared.verb.lineUp,
  remove: COPY.shared.verb.remove,
  none: { kind: "none", plural: SERVER_COPY.season.spiel.aufstellung },
  noKader: { kind: "none", plural: COPY.shared.kader, one: true },
  startersFull: COPY.shared.field.max(STARTERS_MAX),
  nomineeLocked: COPY.aufstellung.nomineeLocked(STARTERS_MAX),
  anonymous: COPY.shared.anonymous,
};

/**
 * The same words for a finished season's line-up, which takes no more players: an empty line-up or squad says none
 * was recorded, where „Noch kein“ would promise one still to come.
 */
export const CLOSED_LINEUP_WORDS: LineupWords = {
  ...LINEUP_WORDS,
  none: { ...LINEUP_WORDS.none, kind: "unrecorded" },
  noKader: { ...LINEUP_WORDS.noKader, kind: "unrecorded" },
};

/** „Nachnominiert“ after the name of a pupil registered after the season began, whom the shortage rule holds. */
function chipOf({ is_nachnominiert }: Pick<FLAufstellungSpieler, "is_nachnominiert">): ChipProps | undefined {
  return is_nachnominiert ? NOMINEE_CHIP : undefined;
}

function playerOf(spieler: FLAufstellungSpieler, gone: boolean): LineupPlayer {
  const mark = rolleMarkOf(spieler.rolle);
  const chip = chipOf(spieler);
  return {
    id: spieler.spieler_id,
    name: spielerName(spieler),
    nummer: shirtNumber(spieler.nummer),
    ...(spieler.position === null ? {} : { position: { record: spieler.position } }),
    ...(mark === undefined ? {} : { mark }),
    ...(chip === undefined ? {} : { chip }),
    ...(spieler.is_nachnominiert ? { nominee: true } : {}),
    // A pupil the stored line-up names whom the squad no longer holds: deregistered or erased since.
    ...(gone ? { gone: COPY.kader.deregistered } : {}),
  };
}

/** The block's players: the club's live squad, and every pupil the stored line-up names outside it. */
export function playersOf(read: Pick<FLAufstellungResponse, "kader" | "named">): LineupPlayer[] {
  return [...read.kader.map((spieler) => playerOf(spieler, false)), ...read.named.map((spieler) => playerOf(spieler, true))];
}
