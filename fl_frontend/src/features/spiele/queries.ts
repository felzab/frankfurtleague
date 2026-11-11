import { orMissing } from "@/core/errors";
import { spieleGetSpielAdmin, spieleGetSpieleSpielplan, teamsGetTeamSpiele } from "@/core/generated/client/sdk";
import { runAdminRead } from "@/shared/utils/adminRead";
import { runPersonRead } from "@/shared/utils/personRead";

import type { FLSpieleAdminSingleResponse, FLSpieleSpielplanAdminResponse, FLTeamSpieleResponse } from "@/core/generated/client/types";

/**
 * The one fixture the match editor loads, admin-tier because it round-trips the rent and the
 * referee's Honorar — two figures a base-tier read withholds (`READ-MONEY-001`).
 *
 * **Uncached, and it stays uncached**.
 */

export async function getAdminSpiel(spielId: string): Promise<FLSpieleAdminSingleResponse | null> {
  return runAdminRead(() =>
    // `null` for "no such fixture", which the editor page turns into `notFound()`. Every other
    // status still throws.
    orMissing(spieleGetSpielAdmin(spielId)),
  );
}

/**
 * One season's matchdays and their matches for the administrator's „Spiele“ list, with the matchday it opens on, a
 * planned season's included. `null` for a season id naming no season, which the page answers as not found.
 * **Uncached**, as every admin read.
 */
export async function getAdminSpielplan(saisonId: string): Promise<FLSpieleSpielplanAdminResponse | null> {
  return runAdminRead(() => orMissing(spieleGetSpieleSpielplan({ saison_id: saisonId })));
}

/**
 * One club's matches in one season for its own „Spiele“ list, each with what is open on it for the club, as a seat
 * holder of the club reads them. **Uncached**: a person's read is made for that person.
 */
export async function getTeamSpiele(teamId: string, saisonId: string): Promise<FLTeamSpieleResponse> {
  return runPersonRead(() => teamsGetTeamSpiele(teamId, saisonId));
}
