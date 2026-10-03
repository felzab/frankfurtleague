"use server";

import { updateTag } from "next/cache";

import { mapEigeneEinwilligungRefusal, WAHL_GESPEICHERT } from "@/features/konto/einwilligung";
import { CustomObjectIdStringSchema } from "@/shared/schemas";
import { refusalResult } from "@/shared/utils/adminMutation";
import { runPersonRecordMutation } from "@/shared/utils/personMutation";
import { toFieldErrors, VALIDATION_FAILED } from "@/shared/utils/validation";

import { patchSchiedsrichterSelbstEinwilligung } from "./mutations";
import { FLSchiedsrichterSelbstEinwilligungPayloadSchema } from "./schemas";

import type { ActionResult } from "@/shared/types/types";
import type { FLSchiedsrichterSelbstEinwilligungPayload } from "./schemas";

/**
 * A referee's own consent. The page binds the record's id, one address possibly holding several
 * referee rows, and the write claims that record, so a retired referee can still withdraw
 * (`docs/frontend/spec.md :: I893`).
 */
export async function patchSchiedsrichterEinwilligungAction(
  schiedsrichterId: string,
  rawPayload: FLSchiedsrichterSelbstEinwilligungPayload,
): Promise<ActionResult> {
  return runPersonRecordMutation("patchSchiedsrichterEinwilligungAction", async () => {
    const id = CustomObjectIdStringSchema.safeParse(schiedsrichterId);
    const validated = FLSchiedsrichterSelbstEinwilligungPayloadSchema.safeParse(rawPayload);

    if (!id.success || !validated.success) {
      return { success: false, error: VALIDATION_FAILED, fieldErrors: validated.success ? undefined : toFieldErrors(validated.error) };
    }

    try {
      await patchSchiedsrichterSelbstEinwilligung(id.data, validated.data);
    } catch (error) {
      const refusal = mapEigeneEinwilligungRefusal(error);
      if (refusal !== null) return refusalResult(refusal);
      throw error;
    }

    // The fixtures read reaches a visitor with the referee's name and is cached for hours; the consent
    // is written on the referee's row alone, so nothing in the write drops that read.
    updateTag("spiele");

    return { success: true, message: WAHL_GESPEICHERT };
  });
}
