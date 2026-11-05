import { cache } from "react";

import { spielberichteGetSelf, spielberichteGetSpielberichtBericht } from "@/core/generated/client/sdk";
import { runPersonRead } from "@/shared/utils/personRead";

import type { FLSpielberichteSelfResponse, FLSpielberichtSchiedsrichterResponse } from "@/core/generated/client/types";

/** What the booked referee's form opens on; refused `bericht_not_officiated` once the fixture is booked to somebody else. */
export async function getSchiedsrichterSpielbericht(spielId: string): Promise<FLSpielberichtSchiedsrichterResponse> {
  return runPersonRead(() => spielberichteGetSpielberichtBericht(spielId));
}

/** The played fixtures booked to the signed-in referee, the panel's list. */
export const getSchiedsrichterSpielberichte = cache(async (): Promise<FLSpielberichteSelfResponse> =>
  runPersonRead(() => spielberichteGetSelf()),
);
