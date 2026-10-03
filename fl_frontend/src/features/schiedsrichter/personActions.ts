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
 * A referee's own consent, pressed on the account page. The page binds the record's id, one address
 * possibly holding several referee rows; it claims that record rather than a seat, so a retired
 * referee reaches the backend to withdraw a consent the league still holds.
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
