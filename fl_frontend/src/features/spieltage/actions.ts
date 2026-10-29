"use server";

import { refusalResult, runAdminMutation } from "@/shared/utils/adminMutation";
import { refusedReplay, restored, runAdminUndo, UNDO_UNREADABLE } from "@/shared/utils/adminUndo";
import { toFieldErrors, VALIDATION_FAILED } from "@/shared/utils/validation";

import { patchSpieltag } from "./mutations";
import { mapSpieltagRefusal, SPIELTAG_REPLAY_REFUSALS } from "./refusals";
import { FLPatchSpieltagPayloadSchema } from "./schemas";

import type { ActionResult } from "@/shared/types/types";
import type { UndoOutcome } from "@/shared/utils/adminUndo";
import type { FLPatchSpieltagPayload, FLSpieltagWriteResponse } from "./schemas";

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

export async function undoAdminSpieltagEditAction(rawPayload: FLPatchSpieltagPayload): Promise<UndoOutcome> {
  return runAdminUndo("undoAdminSpieltagEditAction", async () => {
    const validated = FLPatchSpieltagPayloadSchema.safeParse(rawPayload);
    if (!validated.success) return { success: false, error: UNDO_UNREADABLE };

    try {
      await patchSpieltag(validated.data);
    } catch (error) {
      return refusedReplay(error, SPIELTAG_REPLAY_REFUSALS);
    }

    return restored();
  });
}
