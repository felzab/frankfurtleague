"use server";

import z from "zod";

import { mapEigeneEinwilligungRefusal, WAHL_GESPEICHERT } from "@/features/konto/einwilligung";
import { SAISON_ID_LENGTH } from "@/features/saisons/constants";
import { CustomObjectIdStringSchema } from "@/shared/schemas";
import { refusalResult } from "@/shared/utils/adminMutation";
import { runPersonRecordMutation } from "@/shared/utils/personMutation";
import { toFieldErrors, VALIDATION_FAILED } from "@/shared/utils/validation";

import { patchSitzEinwilligung } from "./mutations";
import { FLSaisonTeamPersonEinwilligungPayloadSchema } from "./schemas";

import type { EinwilligungAntwort, EinwilligungStand } from "@/features/konto/components/forms/EinwilligungForm/EinwilligungForm";
import type { ActionResult } from "@/shared/types/types";

/** The team season the page binds, never a value the reader typed. */
const SitzAdresseSchema = z.object({ team_id: CustomObjectIdStringSchema, saison_id: z.string().length(SAISON_ID_LENGTH) });

/**
 * A seat holder's own media consent for one team season. It claims the person's record on that row,
 * never a seat panel, so a past season's seat holder can still withdraw (`docs/frontend/spec.md :: I893`).
 */
export async function patchSitzEinwilligungAction(
  teamId: string,
  saisonId: string,
  rawPayload: EinwilligungAntwort,
): Promise<ActionResult<{ nachweis_stand: EinwilligungStand }>> {
  return runPersonRecordMutation("patchSitzEinwilligungAction", async () => {
    const adresse = SitzAdresseSchema.safeParse({ team_id: teamId, saison_id: saisonId });
    const validated = FLSaisonTeamPersonEinwilligungPayloadSchema.safeParse(rawPayload);

    if (!adresse.success || !validated.success) {
      return { success: false, error: VALIDATION_FAILED, fieldErrors: validated.success ? undefined : toFieldErrors(validated.error) };
    }

    let antwort;
    try {
      antwort = await patchSitzEinwilligung(adresse.data.team_id, adresse.data.saison_id, validated.data);
    } catch (error) {
      const refusal = mapEigeneEinwilligungRefusal(error);
      if (refusal !== null) return refusalResult(refusal);
      throw error;
    }

    return { success: true, message: WAHL_GESPEICHERT, nachweis_stand: antwort.nachweis_stand };
  });
}
