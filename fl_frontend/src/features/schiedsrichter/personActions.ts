"use server";

import { mapEigeneEinwilligungRefusal, MedienMindestalterSchema, WAHL_GESPEICHERT } from "@/features/konto/einwilligung";
import { CustomObjectIdStringSchema } from "@/shared/schemas";
import { refusalResult } from "@/shared/utils/adminMutation";
import { runPersonRecordMutation } from "@/shared/utils/personMutation";
import { toFieldErrors, VALIDATION_FAILED } from "@/shared/utils/validation";

import { patchSchiedsrichterKontoEinwilligung } from "./mutations";
import { FLSchiedsrichterKontoEinwilligungPayloadSchema } from "./schemas";

import type { FLEinwilligungStand } from "@/core/generated/client/types";
import type { ActionResult } from "@/shared/types/types";
import type z from "zod";

/**
 * A referee's own consent. The page binds the record's id, one address possibly holding several
 * referee rows, and its media floor, and the write claims that record, so a retired referee can still
 * withdraw.
 */
export async function patchSchiedsrichterEinwilligungAction(
  schiedsrichterId: string,
  medienMindestalter: number,
  rawPayload: z.input<typeof FLSchiedsrichterKontoEinwilligungPayloadSchema>,
): Promise<ActionResult<{ nachweis_stand: FLEinwilligungStand }>> {
  return runPersonRecordMutation("patchSchiedsrichterEinwilligungAction", async () => {
    const id = CustomObjectIdStringSchema.safeParse(schiedsrichterId);
    const boden = MedienMindestalterSchema.safeParse(medienMindestalter);
    const validated = FLSchiedsrichterKontoEinwilligungPayloadSchema.safeParse(rawPayload);

    if (!id.success || !boden.success || !validated.success) {
      return { success: false, error: VALIDATION_FAILED, fieldErrors: validated.success ? undefined : toFieldErrors(validated.error) };
    }

    let antwort;
    try {
      antwort = await patchSchiedsrichterKontoEinwilligung(id.data, validated.data);
    } catch (error) {
      const refusal = mapEigeneEinwilligungRefusal(error, boden.data);
      if (refusal !== null) return refusalResult(refusal);
      throw error;
    }

    return { success: true, message: WAHL_GESPEICHERT, nachweis_stand: antwort.nachweis_stand };
  });
}
