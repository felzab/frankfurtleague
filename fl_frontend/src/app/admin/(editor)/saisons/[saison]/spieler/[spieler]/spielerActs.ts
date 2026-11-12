"use server";

import { z } from "zod";

import { action } from "@/core/action";
import { spielerDeleteSaisonSpieler, spielerReactivateSaisonSpieler } from "@/core/generated/client/sdk";
import { SpielerDeleteSaisonSpielerParams, SpielerReactivateSaisonSpielerParams } from "@/core/generated/zod/inputs";

/**
 * Takes the player out of the season's squad from the editor's danger box: the row stays, holding what the player wore,
 * and the row's team can no longer line them up.
 */
export const deregisterSpieler = action({
  lane: "admin",
  name: "deregisterSpieler",
  input: z.object({
    id: SpielerDeleteSaisonSpielerParams.shape.spieler_id,
    saison: SpielerDeleteSaisonSpielerParams.shape.saison_id,
  }),
  run: async ({ id, saison }) => {
    await spielerDeleteSaisonSpieler(id, saison);
    return { ok: true, value: undefined };
  },
});

/**
 * Brings an ausgetragen row back into its squad with what it held. A squad full since is refused in the status line's
 * own sentence; a club a replacement took out of the season, and a role given away since, are a stale page, and the
 * reload shows the page's lock.
 */
export const reactivateSpieler = action({
  lane: "admin",
  name: "reactivateSpieler",
  input: z.object({
    id: SpielerReactivateSaisonSpielerParams.shape.spieler_id,
    saison: SpielerReactivateSaisonSpielerParams.shape.saison_id,
  }),
  ownWords: ["kader_full"],
  run: async ({ id, saison }) => {
    await spielerReactivateSaisonSpieler(id, saison);
    return { ok: true, value: undefined };
  },
});
