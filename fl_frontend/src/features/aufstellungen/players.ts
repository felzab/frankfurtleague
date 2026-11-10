import { COPY } from "@/core/copy";
import { SERVER_COPY } from "@/core/serverCopy";
import { kaderName } from "@/features/spieler/constants";

import { STARTERS_MAX } from "./constants";

import type { Words } from "@/core/copy";
import type { FLAufstellungResponse, FLAufstellungSpieler } from "@/core/generated/client/types";
import type { ChipProps } from "@/kit/Chip";
import type { LineupPlayer, LineupWords } from "@/kit/Lineup";
import type { RoleMarkProps } from "@/kit/RoleMark";

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
  nomineeLocked: COPY.area.team.aufstellung.nomineeLocked,
  anonymous: SERVER_COPY.season.spiel.anonymous,
};

/** A pupil as the club's own people read them, or „anonym“ where an erasure took the record. */
export function nameOf({ first_name, last_name }: Pick<FLAufstellungSpieler, "first_name" | "last_name">): Words {
  return first_name === null ? SERVER_COPY.season.spiel.anonymous : { record: kaderName({ first_name, last_name }) };
}

/** The captain's or the co-captain's mark after the name, where the squad row holds either role. */
export function markOf({ rolle }: Pick<FLAufstellungSpieler, "rolle">): RoleMarkProps | undefined {
  return rolle === null ? undefined : { letters: COPY.shared.rolleMark[rolle], label: COPY.admin.spieler.rolleOption[rolle] };
}

/** „Nachnominiert“ after the name of a pupil registered after the season began, whom the shortage rule holds. */
export function chipOf({ is_nachnominiert }: Pick<FLAufstellungSpieler, "is_nachnominiert">): ChipProps | undefined {
  return is_nachnominiert ? { tone: "info", label: COPY.admin.spieler.nominee } : undefined;
}

/**
 * The shirt number as a figure, `null` where the row holds none. A stored number is one to four digits
 * (`fl_backend/app/api/spieler/schemas.py :: SQUAD_NUMMER_PATTERN`), so it reads whole.
 */
const nummerOf = ({ nummer }: Pick<FLAufstellungSpieler, "nummer">): number | null => (nummer === null ? null : Number(nummer));

function playerOf(spieler: FLAufstellungSpieler, gone: boolean): LineupPlayer {
  const mark = markOf(spieler);
  const chip = chipOf(spieler);
  return {
    id: spieler.spieler_id,
    name: nameOf(spieler),
    nummer: nummerOf(spieler),
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
