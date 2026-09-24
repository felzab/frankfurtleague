"use server";

import { refresh, updateTag } from "next/cache";

import { getAdminSession } from "@/core/auth";
import { ADMIN_FORBIDDEN, refusalResult, runAdminMutation } from "@/shared/utils/adminMutation";
import { buildRefusal } from "@/shared/utils/refusal";
import { toFieldErrors, VALIDATION_FAILED } from "@/shared/utils/validation";

import { patchSpieltag } from "./mutations";
import { mapSpieltagRefusal } from "./refusals";
import { FLPatchSpieltagPayloadSchema } from "./schemas";

import type { ActionResult } from "@/shared/types/types";
import type { FLPatchSpieltagPayload, FLSpieltagWriteResponse } from "./schemas";

function invalidateSpieltage(): void {
  updateTag("spieltage");
}

export async function patchSpieltagAction(rawPayload: FLPatchSpieltagPayload): Promise<ActionResult<{ spieltag?: FLSpieltagWriteResponse }>> {
  return runAdminMutation("patchSpieltagAction", { readOnly: false }, async () => {
    if (!(await getAdminSession())) {
      return { success: false, error: ADMIN_FORBIDDEN };
    }

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

    if (!patchOperation.acknowledged) {
      return { success: false, error: buildRefusal({ reason: "Der Spieltag wurde nicht gespeichert", repair: "Versuche es erneut" }) };
    }

    invalidateSpieltage();
    refresh();

    return { success: true, spieltag: patchOperation, message: "Spieltag gespeichert" };
  });
}
