"use server";

import { refusalResult } from "@/shared/utils/adminMutation";
import { runPersonMutation } from "@/shared/utils/personMutation";
import { toFieldErrors, VALIDATION_FAILED } from "@/shared/utils/validation";

import { KADER_AUSTRAGEN_FOLGE } from "./constants";
import { deleteKaderZeile, patchKaderZeile } from "./mutations";
import { mapKaderZeileRefusal } from "./refusals";
import { FLKaderZeileKeyPayloadSchema, FLPatchKaderZeilePayloadSchema } from "./schemas";

import type { FLKaderRow } from "@/core/generated/client/types";
import type { ActionResult } from "@/shared/types/types";
import type { FLKaderZeileKeyPayload, FLPatchKaderRowPayload } from "./schemas";

/** A seat holder's edit of one live squad row: number, position, level and captaincy, nothing else. */
export async function patchKaderZeileAction(rawPayload: FLPatchKaderRowPayload): Promise<ActionResult<{ kader_zeile?: FLKaderRow }>> {
  return runPersonMutation("patchKaderZeileAction", rawPayload, async () => {
    const validated = FLPatchKaderZeilePayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return { success: false, error: VALIDATION_FAILED, fieldErrors: toFieldErrors(validated.error) };
    }

    let kaderZeile;
    try {
      kaderZeile = await patchKaderZeile(validated.data);
    } catch (error) {
      const refusal = mapKaderZeileRefusal(error);
      if (refusal !== null) return refusalResult(refusal);
      throw error;
    }

    return { success: true, kader_zeile: kaderZeile, message: "Kadereintrag gespeichert" };
  });
}

/** A seat holder's austragen of one live squad row, which only the administrator's reactivate undoes. */
export async function deleteKaderZeileAction(rawPayload: FLKaderZeileKeyPayload): Promise<ActionResult<{ kader_zeile?: FLKaderRow }>> {
  return runPersonMutation("deleteKaderZeileAction", rawPayload, async () => {
    const validated = FLKaderZeileKeyPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return { success: false, error: VALIDATION_FAILED, fieldErrors: toFieldErrors(validated.error) };
    }

    const kaderZeile = await deleteKaderZeile(validated.data);

    return { success: true, kader_zeile: kaderZeile, message: KADER_AUSTRAGEN_FOLGE };
  });
}
