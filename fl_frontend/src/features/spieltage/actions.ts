"use server";

import { refusalResult, runAdminMutation } from "@/shared/utils/adminMutation";
import { toFieldErrors, VALIDATION_FAILED } from "@/shared/utils/validation";

import { patchSpieltag } from "./mutations";
import { mapSpieltagRefusal } from "./refusals";
import { FLPatchSpieltagPayloadSchema } from "./schemas";

import type { FLPatchSpieltagPayload, FLSpieltagWriteResponse } from "@/core/generated/client/types";
import type { ActionResult } from "@/shared/types/types";

export async function patchSpieltagAction(
  rawPayload: FLPatchSpieltagPayload & { id: string },
): Promise<ActionResult<{ spieltag?: FLSpieltagWriteResponse }>> {
  return runAdminMutation("patchSpieltagAction", async () => {
    const validated = FLPatchSpieltagPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return { success: false, error: VALIDATION_FAILED, fieldErrors: toFieldErrors(validated.error) };
    }

    // The span is the whole payload, so `spieltag_outside_saison` lands on `beginn`; `spieltag_span_below_spiele` and
    // `spieltag_beginn_out_of_order` land on the form, each naming a row this page does not show.
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
