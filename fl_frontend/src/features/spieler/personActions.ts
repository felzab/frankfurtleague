"use server";

import { refusalResult } from "@/shared/utils/adminMutation";
import { runPersonMutation } from "@/shared/utils/personMutation";
import { toFieldErrors, VALIDATION_FAILED } from "@/shared/utils/validation";

import { KADER_RETIRE_CONSEQUENCE } from "./constants";
import { deleteKaderRow, patchKaderRow } from "./mutations";
import { mapKaderRowRefusal } from "./refusals";
import { FLKaderRowKeyPayloadSchema, FLPatchKaderRowPayloadSchema } from "./schemas";

import type { FLKaderRow } from "@/core/generated/client/types";
import type { ActionResult } from "@/shared/types/types";
import type { FLKaderRowKeyPayload, FLPatchKaderRowPayload } from "./schemas";

/** A seat holder's edit of one live squad row: number, position, level and captaincy, nothing else. */
export async function patchKaderRowAction(rawPayload: FLPatchKaderRowPayload): Promise<ActionResult<{ kader_row?: FLKaderRow }>> {
  return runPersonMutation("patchKaderRowAction", rawPayload, async () => {
    const validated = FLPatchKaderRowPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return { success: false, error: VALIDATION_FAILED, fieldErrors: toFieldErrors(validated.error) };
    }

    let kaderRow;
    try {
      kaderRow = await patchKaderRow(validated.data);
    } catch (error) {
      const refusal = mapKaderRowRefusal(error);
      if (refusal !== null) return refusalResult(refusal);
      throw error;
    }

    return { success: true, kader_row: kaderRow, message: "Kadereintrag gespeichert" };
  });
}

/** A seat holder's austragen of one live squad row, which only the administrator's reactivate undoes. */
export async function deleteKaderRowAction(rawPayload: FLKaderRowKeyPayload): Promise<ActionResult<{ kader_row?: FLKaderRow }>> {
  return runPersonMutation("deleteKaderRowAction", rawPayload, async () => {
    const validated = FLKaderRowKeyPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return { success: false, error: VALIDATION_FAILED, fieldErrors: toFieldErrors(validated.error) };
    }

    const kaderRow = await deleteKaderRow(validated.data);

    return { success: true, kader_row: kaderRow, message: KADER_RETIRE_CONSEQUENCE };
  });
}
