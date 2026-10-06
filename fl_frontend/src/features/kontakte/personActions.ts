"use server";

import z from "zod";

import { FLBewerbungPersonEinwilligungPayloadSchema } from "@/features/bewerbungen/schemas";
import { mapBewerbungEinwilligungRefusal, mapEigeneEinwilligungRefusal, WAHL_GESPEICHERT } from "@/features/konto/einwilligung";
import { SAISON_ID_LENGTH } from "@/features/saisons/constants";
import { CustomObjectIdStringSchema } from "@/shared/schemas";
import { refusalResult } from "@/shared/utils/adminMutation";
import { runPersonRecordMutation } from "@/shared/utils/personMutation";
import { toFieldErrors, VALIDATION_FAILED } from "@/shared/utils/validation";

import { patchBewerbungEinwilligung, patchSitzEinwilligung } from "./mutations";
import { FLSaisonTeamPersonEinwilligungPayloadSchema } from "./schemas";

import type { FLEinwilligungStand } from "@/features/spieler/schemas";
import type { ActionResult } from "@/shared/types/types";

/** The team season the page binds, never a value the reader typed. */
const SitzAdresseSchema = z.object({ team_id: CustomObjectIdStringSchema, saison_id: z.string().length(SAISON_ID_LENGTH) });

/**
 * A seat holder's own two choices for one team season. It claims the person's record on that row,
 * never a seat panel, so a past season's seat holder can still withdraw (`docs/frontend/spec.md :: I893`).
 */
export async function patchSitzEinwilligungAction(
  teamId: string,
  saisonId: string,
  rawPayload: z.input<typeof FLSaisonTeamPersonEinwilligungPayloadSchema>,
): Promise<ActionResult<{ nachweis_stand: FLEinwilligungStand }>> {
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

/**
 * A seat holder's withdrawal on a pending application, which the page binds. It claims the person's
 * record, the application granting no Funktion, and the backend judges the seat and refuses a grant.
 */
export async function patchBewerbungEinwilligungAction(
  bewerbungId: string,
  rawPayload: z.input<typeof FLBewerbungPersonEinwilligungPayloadSchema>,
): Promise<ActionResult<{ nachweis_stand: FLEinwilligungStand }>> {
  return runPersonRecordMutation("patchBewerbungEinwilligungAction", async () => {
    const id = CustomObjectIdStringSchema.safeParse(bewerbungId);
    const validated = FLBewerbungPersonEinwilligungPayloadSchema.safeParse(rawPayload);

    if (!id.success || !validated.success) {
      return { success: false, error: VALIDATION_FAILED, fieldErrors: validated.success ? undefined : toFieldErrors(validated.error) };
    }

    let antwort;
    try {
      antwort = await patchBewerbungEinwilligung(id.data, validated.data);
    } catch (error) {
      const refusal = mapBewerbungEinwilligungRefusal(error);
      if (refusal !== null) return refusalResult(refusal);
      throw error;
    }

    // No public read serves an application: the spine's refresh is the page's whole re-read.
    return { success: true, message: WAHL_GESPEICHERT, nachweis_stand: antwort.nachweis_stand };
  });
}
