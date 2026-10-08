"use server";

import { mapEigeneEinwilligungRefusal, WAHL_GESPEICHERT } from "@/features/konto/einwilligung";
import { CustomObjectIdStringSchema } from "@/shared/schemas";
import { invalidatesOnWrite, refusalResult } from "@/shared/utils/adminMutation";
import { runPersonRecordMutation } from "@/shared/utils/personMutation";
import { toFieldErrors, VALIDATION_FAILED } from "@/shared/utils/validation";

import { patchSchiedsrichterSelbstEinwilligung } from "./mutations";
import { FLSchiedsrichterSelbstEinwilligungPayloadSchema } from "./schemas";

import type { FLEinwilligungStand } from "@/features/spieler/schemas";
import type { ActionResult } from "@/shared/types/types";
import type z from "zod";

/**
 * A referee's own consent. The page binds the record's id, one address possibly holding several
 * referee rows, and the write claims that record, so a retired referee can still withdraw
 * (`docs/frontend/spec.md :: I639`).
 */
export async function patchSchiedsrichterEinwilligungAction(
  schiedsrichterId: string,
  rawPayload: z.input<typeof FLSchiedsrichterSelbstEinwilligungPayloadSchema>,
): Promise<ActionResult<{ nachweis_stand: FLEinwilligungStand }>> {
  return runPersonRecordMutation("patchSchiedsrichterEinwilligungAction", async () => {
    const id = CustomObjectIdStringSchema.safeParse(schiedsrichterId);
    const validated = FLSchiedsrichterSelbstEinwilligungPayloadSchema.safeParse(rawPayload);

    if (!id.success || !validated.success) {
      return { success: false, error: VALIDATION_FAILED, fieldErrors: validated.success ? undefined : toFieldErrors(validated.error) };
    }

    // Ahead of the fixture read joining this record, which will serve the referee's name by its scope and
    // is cached for hours: the consent is written on the referee's row alone, so no write of it drops that read.
    invalidatesOnWrite("spiele");
    let antwort;
    try {
      antwort = await patchSchiedsrichterSelbstEinwilligung(id.data, validated.data);
    } catch (error) {
      const refusal = mapEigeneEinwilligungRefusal(error);
      if (refusal !== null) return refusalResult(refusal);
      throw error;
    }

    return { success: true, message: WAHL_GESPEICHERT, nachweis_stand: antwort.nachweis_stand };
  });
}
