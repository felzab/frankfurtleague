"use server";

// Redesign: goes with its last importer, the old match form's create dialog (`AdminCreateSchiedsrichterForm.tsx`).
import { refusalResult, runAdminMutation } from "@/shared/utils/adminMutation";
import { toFieldErrors, VALIDATION_FAILED } from "@/shared/utils/validation";

import { postSchiedsrichter } from "./mutations";
import { mapGesperrteAdresseRefusal, mapNameRefusal } from "./refusals";
import { FLPostSchiedsrichterPayloadSchema } from "./schemas";

import type { FLSchiedsrichterPayloadDraft } from "@/features/schiedsrichter/schemas";
import type { ActionResult } from "@/shared/types/types";
import type { FLPostSchiedsrichterPayload } from "./schemas";

/**
 * What the administrator is told of the confirmation link a write owed: the address the write's own transaction read,
 * never the one this caller sent, a save landing between the two having moved the mailbox. The Postausgang mails it at
 * once, behind the response; the editor's panel then shows what became of it.
 */
function linkSatz(email: string): string {
  return `Der Bestätigungslink geht an ${email}.`;
}

export async function postSchiedsrichterAction(
  // The DRAFT shape: an emptied money field submits `null`, which the schema below makes a field error.
  rawPayload: FLSchiedsrichterPayloadDraft<FLPostSchiedsrichterPayload>,
): Promise<ActionResult<{ created_id: string }>> {
  return runAdminMutation("postSchiedsrichterAction", { stepUp: true }, async () => {
    const validated = FLPostSchiedsrichterPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return {
        success: false,
        error: VALIDATION_FAILED,
        fieldErrors: toFieldErrors(validated.error),
      };
    }

    // The refusal belongs on the box that holds the name or the address, not on the error page.
    let postOperation;
    try {
      postOperation = await postSchiedsrichter(validated.data);
    } catch (error) {
      const refusal = mapNameRefusal(error) ?? mapGesperrteAdresseRefusal(error);
      if (refusal) return refusalResult(refusal);
      throw error;
    }

    return {
      success: true,
      created_id: postOperation.created_id,
      message: linkSatz(postOperation.confirmation.email),
    };
  });
}
