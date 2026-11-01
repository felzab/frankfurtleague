"use server";

import { refusalResult, runAdminMutation } from "@/shared/utils/adminMutation";
import { toFieldErrors, VALIDATION_FAILED } from "@/shared/utils/validation";

import { deleteSpielort, patchSpielort, postSpielort, reactivateSpielort } from "./mutations";
import { mapNameRefusal, mapRetireRefusal } from "./refusals";
import { FLPatchSpielortPayloadSchema, FLPostSpielortPayloadSchema, FLSpielortKeyPayloadSchema } from "./schemas";

import type { FLSpielortPayloadDraft } from "@/features/spielorte/schemas";
import type { ActionResult } from "@/shared/types/types";
import type { FLPatchSpielortPayload, FLPostSpielortPayload, FLSpielortKeyPayload } from "./schemas";

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

export async function patchSpielortAction(
  // The DRAFT shape: an emptied money field submits `null`, which the schema below makes a field error.
  rawPayload: FLSpielortPayloadDraft<FLPatchSpielortPayload>,
): Promise<ActionResult> {
  return runAdminMutation("patchSpielortAction", async () => {
    const validated = FLPatchSpielortPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return {
        success: false,
        error: VALIDATION_FAILED,
        fieldErrors: toFieldErrors(validated.error),
      };
    }

    // The refusal belongs on the box that holds the name, not on the error page.
    try {
      await patchSpielort(validated.data);
    } catch (error) {
      const refusal = mapNameRefusal(error);
      if (refusal) return refusalResult(refusal);
      throw error;
    }

    return {
      success: true,
      message: "Spielort bearbeitet",
    };
  });
}

export async function deleteSpielortAction(rawPayload: FLSpielortKeyPayload): Promise<ActionResult> {
  return runAdminMutation("deleteSpielortAction", async () => {
    const validated = FLSpielortKeyPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return {
        success: false,
        error: VALIDATION_FAILED,
        fieldErrors: toFieldErrors(validated.error),
      };
    }

    // The refusal belongs in the dialog rather than on the error page.
    try {
      await deleteSpielort(validated.data);
    } catch (error) {
      const refusal = mapRetireRefusal(error);
      if (refusal !== null) return { success: false, error: refusal };
      throw error;
    }

    return {
      success: true,
      message: "Seine Spiele bleiben erhalten.",
    };
  });
}

/**
 * No tag moves, unlike the patch: `inactive_since` reaches no cached read. The spine's refresh is for
 * the admin's own list, which is uncached. The endpoint refuses nothing — a venue coming back takes
 * no fixtures with it.
 */
export async function reactivateSpielortAction(rawPayload: FLSpielortKeyPayload): Promise<ActionResult> {
  return runAdminMutation("reactivateSpielortAction", async () => {
    const validated = FLSpielortKeyPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return {
        success: false,
        error: VALIDATION_FAILED,
        fieldErrors: toFieldErrors(validated.error),
      };
    }

    await reactivateSpielort(validated.data);
    return {
      success: true,
      message: "Spielort reaktiviert",
    };
  });
}
