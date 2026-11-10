import { COPY } from "@/core/copy";
import { SERVER_COPY } from "@/core/serverCopy";
import { roleMarkOf, shirtNumber, spielerName } from "@/features/spieler/constants";

import { STARTERS_MAX } from "./constants";

import type { FLAufstellungResponse, FLAufstellungSpieler } from "@/core/generated/client/types";
import type { ChipProps } from "@/kit/Chip";
import type { LineupPlayer, LineupWords } from "@/kit/Lineup";

/** Every word the line-up's block shows, on the team's page and the administrator's alike. */
export const LINEUP_WORDS: LineupWords = {
  picked: SERVER_COPY.season.spiel.aufstellung,
  rest: COPY.area.team.aufstellung.rest,
  name: SERVER_COPY.season.column.name,
  nummer: SERVER_COPY.season.column.nummer,
  position: SERVER_COPY.season.column.position,
  starts: COPY.shared.startelf,
  pick: COPY.shared.verb.lineUp,
  remove: COPY.shared.verb.remove,
  none: COPY.shared.empty.none(SERVER_COPY.season.spiel.aufstellung),
  noSquad: COPY.shared.empty.noneOne(COPY.shared.kader),
  startersFull: COPY.shared.field.max(STARTERS_MAX),
  nomineeLocked: COPY.area.team.aufstellung.nomineeLocked(STARTERS_MAX),
  anonymous: SERVER_COPY.season.spiel.anonymous,
};

/** „Nachnominiert“ after the name of a pupil registered after the season began, whom the shortage rule holds. */
function chipOf({ is_nachnominiert }: Pick<FLAufstellungSpieler, "is_nachnominiert">): ChipProps | undefined {
  return is_nachnominiert ? { tone: "info", label: COPY.admin.spieler.nominee } : undefined;
}

function playerOf(spieler: FLAufstellungSpieler, gone: boolean): LineupPlayer {
  const mark = roleMarkOf(spieler.rolle);
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
    ...(gone ? { gone: COPY.admin.spieler.deregistered } : {}),
  };
}

/** The block's players: the club's live squad, and every pupil the stored line-up names outside it. */
export function playersOf(read: Pick<FLAufstellungResponse, "kader" | "named">): LineupPlayer[] {
  return [...read.kader.map((spieler) => playerOf(spieler, false)), ...read.named.map((spieler) => playerOf(spieler, true))];
}
