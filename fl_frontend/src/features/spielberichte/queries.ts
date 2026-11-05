import { cache } from "react";

import { spielberichteGetSelf, spielberichteGetSpielberichtBericht, spielberichteGetSpielberichtVerwaltung } from "@/core/generated/client/sdk";
import { runAdminRead } from "@/shared/utils/adminRead";
import { runPersonRead } from "@/shared/utils/personRead";

import type {
  FLSpielberichtAdminResponse,
  FLSpielberichteSelfResponse,
  FLSpielberichtSchiedsrichterResponse,
  SpielberichteGetSpielberichtVerwaltungParams,
} from "@/core/generated/client/types";

/**
 * One fixture's report as the administrator reads it, remarks and reasons included, with its state. Uncached: an
 * admin-tier read. Both squads come only with `kader`, for a form picking from them; without it they read empty.
 */
export async function getAdminSpielbericht(
  spielId: string,
  params: SpielberichteGetSpielberichtVerwaltungParams = {},
): Promise<FLSpielberichtAdminResponse> {
  return runAdminRead(() => spielberichteGetSpielberichtVerwaltung(spielId, params));
}

/** What the booked referee's form opens on; refused `bericht_not_officiated` once the fixture is booked to somebody else. */
export async function getSchiedsrichterSpielbericht(spielId: string): Promise<FLSpielberichtSchiedsrichterResponse> {
  return runPersonRead(() => spielberichteGetSpielberichtBericht(spielId));
}

/** The played fixtures booked to the signed-in referee, the panel's list. */
export const getSchiedsrichterSpielberichte = cache(async (): Promise<FLSpielberichteSelfResponse> =>
  runPersonRead(() => spielberichteGetSelf()),
);
