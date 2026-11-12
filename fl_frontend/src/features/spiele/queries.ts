import { orMissing } from "@/core/errors";
import { spieleGetSpielAdmin, spieleGetSpieleSpielplan, teamsGetTeamSpiele } from "@/core/generated/client/sdk";
import { runAdminRead } from "@/shared/utils/adminRead";
import { runPersonRead } from "@/shared/utils/personRead";

import type { FLSpieleAdminSingleResponse, FLSpieleSpielplanAdminResponse, FLTeamSpieleResponse } from "@/core/generated/client/types";

/** Admin-tier: it round-trips the rent and the referee's Honorar, two figures a base-tier read withholds. */
// Never `"use cache"`, which keys on the arguments rather than the caller.
export async function getAdminSpiel(spielId: string): Promise<FLSpieleAdminSingleResponse | null> {
  return runAdminRead(() =>
    // `null` for "no such fixture", which the editor page turns into `notFound()`. Every other
    // status still throws.
    orMissing(spieleGetSpielAdmin(spielId)),
  );
}

/** A planned season's included; `null` for a season id naming no season, which the page answers as not found. */
// Never `"use cache"`, which keys on the arguments rather than the caller.
export async function getAdminSpielplan(saisonId: string): Promise<FLSpieleSpielplanAdminResponse | null> {
  return runAdminRead(() => orMissing(spieleGetSpieleSpielplan({ saison_id: saisonId })));
}

// A person's read, never `"use cache"`, which keys on the arguments rather than the caller.
export async function getTeamSpiele(teamId: string, saisonId: string): Promise<FLTeamSpieleResponse> {
  return runPersonRead(() => teamsGetTeamSpiele(teamId, saisonId));
}
