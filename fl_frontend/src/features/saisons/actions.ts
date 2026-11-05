"use server";

// Session 6: goes with the old team editor, the group swap's last old caller; the season editor swaps through its own
// action (`fl_frontend/src/app/admin/(editor)/saisons/[saison]/settings/saisonActs.ts :: swapGruppen`).
import { runAdminMutation } from "@/shared/utils/adminMutation";
import { toFieldErrors, VALIDATION_FAILED } from "@/shared/utils/validation";

import { swapGruppen } from "./mutations";
import { mapSwapRefusal } from "./refusals";
import { FLSwapGruppenPayloadSchema } from "./schemas";

import type { FLSwapGruppenPayload, FLSwapGruppenResponse } from "@/core/generated/client/types";
import type { ActionResult } from "@/shared/types/types";

/**
 * Two clubs exchange groups. The same transaction rewrites every drawn Gruppenphase fixture fielding
 * either club.
 */
export async function swapGruppenAction(
  rawPayload: FLSwapGruppenPayload & { saison_id: string },
): Promise<ActionResult<{ swap?: FLSwapGruppenResponse }>> {
  return runAdminMutation("swapGruppenAction", async () => {
    const validated = FLSwapGruppenPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return { success: false, error: VALIDATION_FAILED, fieldErrors: toFieldErrors(validated.error) };
    }

    let swapOperation;
    try {
      swapOperation = await swapGruppen(validated.data);
    } catch (error) {
      const refusal = mapSwapRefusal(error);
      if (refusal !== null) return { success: false, error: refusal };
      throw error;
    }

    const umgeschrieben =
      swapOperation.rewritten_spiele === 0
        ? "Angesetzte Spiele gab es für die beiden noch keine."
        : swapOperation.rewritten_spiele === 1
          ? "Ein angesetztes Spiel wurde mitgetauscht."
          : `${String(swapOperation.rewritten_spiele)} angesetzte Spiele wurden mitgetauscht.`;

    return {
      success: true,
      swap: swapOperation,
      message: `Die beiden Teams stehen jetzt in Gruppe ${swapOperation.team1_gruppe} und Gruppe ${swapOperation.team2_gruppe}. ${umgeschrieben}`,
    };
  });
}
