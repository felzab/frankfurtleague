"use server";

import { updateTag } from "next/cache";

import { getAdminSession } from "@/core/auth";
import { APIBadStatusError } from "@/core/errors";
import { ADMIN_FORBIDDEN, runAdminMutation, VALIDATION_FAILED } from "@/shared/utils/adminMutation";
import { toFieldErrors } from "@/shared/utils/validation";

import { patchSpieltag } from "./mutations";
import { FLPatchSpieltagPayloadSchema } from "./schemas";

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
      error:
        "Mindestens ein Spiel dieses Spieltags liegt außerhalb des neuen Zeitraums. Erweitere den Zeitraum wieder oder verlege diese Spiele.",
    };
  }
  return null;
}

function invalidateSpieltage(): void {
  updateTag("spieltage");
}

export async function patchSpieltagAction(rawPayload: FLPatchSpieltagPayload): Promise<{
  success: boolean;
  spieltag?: FLSpieltagWriteResponse;
  message?: string;
  error?: string;
  fieldErrors?: FieldErrors;
}> {
  return runAdminMutation("patchSpieltagAction", async () => {
    if (!(await getAdminSession())) {
      return { success: false, error: ADMIN_FORBIDDEN };
    }

    const validated = FLPatchSpieltagPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return { success: false, error: VALIDATION_FAILED, fieldErrors: toFieldErrors(validated.error) };
    }

    // The span is the whole payload, so `REQ-DATE-002` lands on `beginn` and `REQ-DATE-003` on the
    // form: the fixtures it names are not on this page.
    let patchOperation;
    try {
      patchOperation = await patchSpieltag(validated.data);
    } catch (error) {
      const refusal = mapSpieltagRefusal(error);
      if (refusal) return { success: false, error: refusal.error ?? VALIDATION_FAILED, fieldErrors: refusal.fieldErrors };
      throw error;
    }

    if (!patchOperation.acknowledged) {
      return { success: false, error: "Bei der Bearbeitung des Spieltags ist ein unerwarteter Fehler aufgetreten" };
    }

    invalidateSpieltage();

    return { success: true, spieltag: patchOperation, message: "Spieltag gespeichert!" };
  });
}
