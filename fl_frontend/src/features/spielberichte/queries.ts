import { cache } from "react";

import { spielberichteGetSelf, spielberichteGetSpielberichtBericht, spielberichteGetSpielberichte } from "@/core/generated/client/sdk";
import { runAdminRead } from "@/shared/utils/adminRead";
import { runPersonRead } from "@/shared/utils/personRead";

import type {
  FLSpielberichteSaisonResponse,
  FLSpielberichteSelfResponse,
  FLSpielberichtSchiedsrichterResponse,
  SpielberichteGetSpielberichteParams,
} from "@/core/generated/client/types";

/** Every report of a season holding a block, each with its state: what the season editor counts. */
export async function getSpielberichteZustaende(filters: SpielberichteGetSpielberichteParams = {}): Promise<FLSpielberichteSaisonResponse> {
  return runAdminRead(() => spielberichteGetSpielberichte(filters));
}

/** What the booked referee's form opens on; refused `bericht_not_officiated` once the fixture is booked to somebody else. */
export async function getSchiedsrichterSpielbericht(spielId: string): Promise<FLSpielberichtSchiedsrichterResponse> {
  return runPersonRead(() => spielberichteGetSpielberichtBericht(spielId));
}

/** The played fixtures booked to the signed-in referee, the panel's list. */
export const getSchiedsrichterSpielberichte = cache(async (): Promise<FLSpielberichteSelfResponse> =>
  runPersonRead(() => spielberichteGetSelf()),
);
