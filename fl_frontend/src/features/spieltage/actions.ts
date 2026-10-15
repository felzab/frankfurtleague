"use server";

import { invalidatesOnWrite, refusalResult, runAdminMutation } from "@/shared/utils/adminMutation";
import { refusedReplay, restored, runAdminUndo, unclearReplay, UNDO_UNREADABLE } from "@/shared/utils/adminUndo";
import { buildRefusal, VERSUCHE_ES_ERNEUT } from "@/shared/utils/refusal";
import { toFieldErrors, VALIDATION_FAILED } from "@/shared/utils/validation";

import { patchSpieltag } from "./mutations";
import { mapSpieltagRefusal, SPIELTAG_REPLAY_REFUSALS } from "./refusals";
import { FLPatchSpieltagPayloadSchema } from "./schemas";

import type { ActionResult } from "@/shared/types/types";
import type { UndoOutcome } from "@/shared/utils/adminUndo";
import type { FLPatchSpieltagPayload, FLSpieltagWriteResponse } from "./schemas";

function invalidateSpieltage(): void {
  invalidatesOnWrite("spieltage");
}

export async function patchSpieltagAction(rawPayload: FLPatchSpieltagPayload): Promise<ActionResult<{ spieltag?: FLSpieltagWriteResponse }>> {
  return runAdminMutation("patchSpieltagAction", async () => {
    const validated = FLPatchSpieltagPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return { success: false, error: VALIDATION_FAILED, fieldErrors: toFieldErrors(validated.error) };
    }

    invalidateSpieltage();
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
      return { success: false, error: buildRefusal({ reason: "Der Spieltag wurde nicht gespeichert", repair: VERSUCHE_ES_ERNEUT }) };
    }

    return { success: true, spieltag: patchOperation, message: "Spieltag gespeichert" };
  });
}

export async function undoAdminSpieltagEditAction(rawPayload: FLPatchSpieltagPayload): Promise<UndoOutcome> {
  return runAdminUndo("undoAdminSpieltagEditAction", async () => {
    const validated = FLPatchSpieltagPayloadSchema.safeParse(rawPayload);
    if (!validated.success) return { success: false, error: UNDO_UNREADABLE };

    invalidateSpieltage();
    let operation;
    try {
      operation = await patchSpieltag(validated.data);
    } catch (error) {
      return refusedReplay(error, SPIELTAG_REPLAY_REFUSALS);
    }

    return operation.acknowledged ? restored() : unclearReplay("Die Rücknahme wurde abgebrochen. Prüfe den Spieltag.");
  });
}
