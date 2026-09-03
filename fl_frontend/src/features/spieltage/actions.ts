"use server";

import { updateTag } from "next/cache";

import { getAdminSession } from "@/core/auth";
import { APIBadStatusError } from "@/core/errors";
import { ADMIN_FORBIDDEN, runAdminMutation, VALIDATION_FAILED } from "@/shared/utils/adminMutation";
import { buildRefusal } from "@/shared/utils/refusal";
import { toFieldErrors } from "@/shared/utils/validation";

import { patchSpieltag } from "./mutations";
import { FLPatchSpieltagPayloadSchema } from "./schemas";

import type { ActionResult } from "@/shared/types/types";
import type { FieldErrors } from "@/shared/utils/validation";
import type { FLPatchSpieltagPayload, FLSpieltagWriteResponse } from "./schemas";

/** Every refusal an edit can draw, in German, or `null` when none applies. */
function mapSpieltagRefusal(error: unknown): { error?: string; fieldErrors?: FieldErrors } | null {
  if (!(error instanceof APIBadStatusError) || error.statusCode !== 409) return null;

  if (error.serverErrorCode === "REQ-DATE-002") {
    return { fieldErrors: { beginn: "Dieser Zeitraum liegt außerhalb des Zeitraums der Saison." } };
  }
  if (error.serverErrorCode === "REQ-DATE-003") {
    return {
      error: buildRefusal({
        reason: "Mindestens ein Spiel dieses Spieltags liegt außerhalb des neuen Zeitraums",
        repair: "Erweitere den Zeitraum wieder oder verlege diese Spiele",
      }),
    };
  }
  // One code carries both arms and the wire names neither, so the remedy is pinned to the matchday
  // the admin means to play later, the one referent that lands right in both. `ende` is the field
  // the rule leaves free, and only the dated rows are named.
  if (error.serverErrorCode === "REQ-DATE-008") {
    return {
      error:
        "Der Beginn dieses Spieltags muss in die Reihenfolge der Spieltage seiner Phase passen, die schon einen Zeitraum haben. " +
        "Das Ende ist daran nicht gebunden und darf weiter reichen. Verlege die Spiele des Spieltags, der später gespielt werden " +
        "soll, in die späteren Tage seines Zeitraums.",
    };
  }
  return null;
}

function invalidateSpieltage(): void {
  updateTag("spieltage");
}

export async function patchSpieltagAction(rawPayload: FLPatchSpieltagPayload): Promise<ActionResult<{ spieltag?: FLSpieltagWriteResponse }>> {
  return runAdminMutation("patchSpieltagAction", async () => {
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
      if (refusal) return { success: false, error: refusal.error ?? VALIDATION_FAILED, fieldErrors: refusal.fieldErrors };
      throw error;
    }

    if (!patchOperation.acknowledged) {
      return { success: false, error: buildRefusal({ reason: "Der Spieltag wurde nicht gespeichert", repair: "Versuche es erneut" }) };
    }

    invalidateSpieltage();

    return { success: true, spieltag: patchOperation, message: "Spieltag gespeichert" };
  });
}
