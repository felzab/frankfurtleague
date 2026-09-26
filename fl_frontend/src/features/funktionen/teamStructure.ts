import { TEAM_SIDEMENU_ENTRIES } from "./constants";

import type { SidemenuStructure } from "@/shared/types/types";
import type { TeamIconName } from "./constants";
import type { TeamSeat } from "./teamSeats";

// In a module apart from the table, so `structure.test.ts` can hand it a table longer than today's.
/**
 * The team shell's one unnamed group for the seats held at the address's team and season: every entry
 * for any seat, since the Trainer's reaches exactly what an Ansprechperson's does, and none for no seat.
 */
export function teamStructureFor(seats: readonly TeamSeat[]): SidemenuStructure<TeamIconName> {
  return seats.length === 0 ? [] : [{ category_name: "", sub_options: [...TEAM_SIDEMENU_ENTRIES] }];
}
