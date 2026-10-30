"use server";

import { refusalResult, runAdminMutation } from "@/shared/utils/adminMutation";
import { toFieldErrors, VALIDATION_FAILED } from "@/shared/utils/validation";

import { patchSpieltag } from "./mutations";
import { mapSpieltagRefusal } from "./refusals";
import { FLPatchSpieltagPayloadSchema } from "./schemas";

import type { FLSpieltagWriteResponse } from "@/core/generated/client/types";
import type { ActionResult } from "@/shared/types/types";
import type { FLPatchSpieltagPayload } from "./schemas";

export async function patchSpieltagAction(rawPayload: FLPatchSpieltagPayload): Promise<ActionResult<{ spieltag?: FLSpieltagWriteResponse }>> {
  return runAdminMutation("patchSpieltagAction", async () => {
    const validated = FLPatchSpieltagPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return { success: false, error: VALIDATION_FAILED, fieldErrors: toFieldErrors(validated.error) };
    }

    // The span is the whole payload, so `REQ-DATE-002` lands on `beginn`; `REQ-DATE-003` and
    // `REQ-DATE-008` land on the form, each naming a row this page does not show.
    let patchOperation;
    try {
      patchOperation = await patchSpieltag(validated.data);
    } catch (error) {
      const refusal = mapSpieltagRefusal(error);
      if (refusal) return refusalResult(refusal);
      throw error;
    }

    return { success: true, spieltag: patchOperation, message: "Spieltag gespeichert" };
  });
}
