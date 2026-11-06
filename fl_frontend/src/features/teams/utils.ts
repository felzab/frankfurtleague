import { GRUPPEN_OPTIONS, TRIKOT_FARBE_OPTIONS } from "./constants";

import type { FLSaisonRules, FLTeamMembership, FLTrikotFarbe } from "@/core/generated/client/types";
import type { TrikotFarbeOption } from "./constants";
import type { GruppeOffer } from "./types";

/**
 * Every junction row counts — a disqualified team never leaves its season. The pickers disable what
 * `POST /teams/{team_id}/saisons` would refuse (`entry_gruppe_not_offered/003`), which stays authoritative.
 */
export const buildGruppeOffer = (saisonId: string, rules: FLSaisonRules, memberships: readonly FLTeamMembership[][]): GruppeOffer[] => {
  const occupied = new Map<string, number>();
  for (const teamMemberships of memberships) {
    for (const membership of teamMemberships) {
      if (membership.saison_id === saisonId) occupied.set(membership.gruppe, (occupied.get(membership.gruppe) ?? 0) + 1);
    }
  }

  return GRUPPEN_OPTIONS.slice(0, rules.number_of_gruppen).map((gruppe) => ({
    gruppe,
    occupied: occupied.get(gruppe) ?? 0,
    capacity: rules.teams_per_gruppe,
  }));
};

/**
 * Which colours a picker offers once the season's ASSIGNED ones are left out. Its own function
 * because the empty offer is a boundary a test can exercise without rendering.
 */
export function offeredTrikotFarben({
  taken,
  value,
}: {
  taken: readonly FLTrikotFarbe[];
  /** The colour the field already holds, which survives the exclusion so a saved row still reads. */
  value: FLTrikotFarbe | null;
}): readonly TrikotFarbeOption[] {
  // The exclusion and nothing else, so the picker never offers a colour the season has given away.
  // A season holding every colour therefore offers nothing, which the required wish has no answer for.
  return TRIKOT_FARBE_OPTIONS.filter((option) => option.value === value || !taken.includes(option.value));
}
