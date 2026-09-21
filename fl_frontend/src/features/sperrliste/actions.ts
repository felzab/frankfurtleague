"use server";

import { refresh } from "next/cache";

import { getAdminSession } from "@/core/auth";
import { ADMIN_FORBIDDEN, refusalResult, runAdminMutation, VALIDATION_FAILED } from "@/shared/utils/adminMutation";
import { buildRefusal } from "@/shared/utils/refusal";
import { toFieldErrors } from "@/shared/utils/validation";

import { deleteSperre, postSperre } from "./mutations";
import { mapAdresseRefusal } from "./refusals";
import { FLPostSperrlistePayloadSchema, FLSperrlisteKeyPayloadSchema } from "./schemas";

import type { ActionResult } from "@/shared/types/types";
import type { FLPostSperrlistePayload, FLSperrlisteKeyPayload } from "./schemas";

export async function postSperreAction(rawPayload: FLPostSperrlistePayload): Promise<ActionResult<{ created_id: string }>> {
  return runAdminMutation("postSperreAction", async () => {
    if (!(await getAdminSession())) {
      return { success: false, error: ADMIN_FORBIDDEN };
    }

    const validated = FLPostSperrlistePayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return {
        success: false,
        error: VALIDATION_FAILED,
        fieldErrors: toFieldErrors(validated.error),
      };
    }

    // The refusal belongs on the box that holds the address, not on the error page.
    let postOperation;
    try {
      postOperation = await postSperre(validated.data);
    } catch (error) {
      const refusal = mapAdresseRefusal(error);
      if (refusal) return refusalResult(refusal);
      throw error;
    }

    if (!postOperation.acknowledged) {
      return { success: false, error: buildRefusal({ reason: "Die Adresse wurde nicht gesperrt", repair: "Versuche es erneut" }) };
    }

    refresh();

    return { success: true, created_id: postOperation.created_id, message: "Adresse gesperrt" };
  });
}

/**
 * No tag moves: the ban list reaches no cached read, and the refresh below is for the admin's own
 * uncached list. A row another administrator has already lifted answers 404, which
 * `fl_frontend/src/shared/utils/actionError.ts` words as the reload it is.
 */
export async function deleteSperreAction(rawPayload: FLSperrlisteKeyPayload): Promise<ActionResult> {
  return runAdminMutation("deleteSperreAction", async () => {
    if (!(await getAdminSession())) {
      return { success: false, error: ADMIN_FORBIDDEN };
    }

    const validated = FLSperrlisteKeyPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return {
        success: false,
        error: VALIDATION_FAILED,
        fieldErrors: toFieldErrors(validated.error),
      };
    }

    const deleteOperation = await deleteSperre(validated.data);

    if (!deleteOperation.acknowledged) {
      return { success: false, error: buildRefusal({ reason: "Die Sperre wurde nicht aufgehoben", repair: "Versuche es erneut" }) };
    }

    refresh();

    return { success: true, message: "Diese Adresse wird nicht mehr abgewiesen." };
  });
}
