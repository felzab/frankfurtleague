"use server";

import { updateTag } from "next/cache";

import { refusalResult } from "@/shared/utils/adminMutation";
import { runPersonMutation } from "@/shared/utils/personMutation";
import { toFieldErrors, VALIDATION_FAILED } from "@/shared/utils/validation";

import { KADER_AUSTRAGEN_FOLGE } from "./constants";
import { deleteKaderZeile, patchKaderZeile } from "./mutations";
import { mapKaderZeileRefusal } from "./refusals";
import { FLKaderZeileKeyPayloadSchema, FLPatchKaderZeilePayloadSchema } from "./schemas";

import type { ActionResult } from "@/shared/types/types";
import type { FLKaderZeileKeyPayload, FLKaderZeileResponse, FLPatchKaderZeilePayload } from "./schemas";

/**
 * The public squad read is cached for days and joins every squad row, so a seat holder's edit drops its
 * base tag as the administrator's does (`fl_frontend/src/features/spieler/queries.ts :: getSpieler`).
 */
function invalidateSpieler(): void {
  updateTag("spieler");
}

/** A seat holder's edit of one live squad row: number, position, level and captaincy, nothing else. */
export async function patchKaderZeileAction(
  rawPayload: FLPatchKaderZeilePayload,
): Promise<ActionResult<{ kader_zeile?: FLKaderZeileResponse }>> {
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

    invalidateSpieler();

    return { success: true, kader_zeile: kaderZeile, message: "Kadereintrag gespeichert" };
  });
}

/** A seat holder's austragen of one live squad row, which only the administrator's reactivate undoes. */
export async function deleteKaderZeileAction(
  rawPayload: FLKaderZeileKeyPayload,
): Promise<ActionResult<{ kader_zeile?: FLKaderZeileResponse }>> {
  return runPersonMutation("deleteKaderZeileAction", rawPayload, async () => {
    const validated = FLKaderZeileKeyPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return { success: false, error: VALIDATION_FAILED, fieldErrors: toFieldErrors(validated.error) };
    }

    const kaderZeile = await deleteKaderZeile(validated.data);

    invalidateSpieler();

    return { success: true, kader_zeile: kaderZeile, message: KADER_AUSTRAGEN_FOLGE };
  });
}
