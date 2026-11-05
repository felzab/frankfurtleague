"use server";

// Redesign: goes with its last importer, the old match form's create dialog (`AdminCreateSpielortForm.tsx`).
import { refusalResult, runAdminMutation } from "@/shared/utils/adminMutation";
import { toFieldErrors, VALIDATION_FAILED } from "@/shared/utils/validation";

import { postSpielort } from "./mutations";
import { mapNameRefusal } from "./refusals";
import { FLPostSpielortPayloadSchema } from "./schemas";

import type { FLSpielortPayloadDraft } from "@/features/spielorte/schemas";
import type { ActionResult } from "@/shared/types/types";
import type { FLPostSpielortPayload } from "./schemas";

export async function postSpielortAction(
  // The DRAFT shape: an emptied money field submits `null`, which the schema below makes a field error.
  rawPayload: FLSpielortPayloadDraft<FLPostSpielortPayload>,
): Promise<ActionResult<{ created_id: string }>> {
  return runAdminMutation("postSpielortAction", async () => {
    const validated = FLPostSpielortPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return {
        success: false,
        error: VALIDATION_FAILED,
        fieldErrors: toFieldErrors(validated.error),
      };
    }

    // The refusal belongs on the box that holds the name, not on the error page.
    let postOperation;
    try {
      postOperation = await postSpielort(validated.data);
    } catch (error) {
      const refusal = mapNameRefusal(error);
      if (refusal) return refusalResult(refusal);
      throw error;
    }

    return { success: true, created_id: postOperation.created_id, message: "Spielort angelegt" };
  });
}
