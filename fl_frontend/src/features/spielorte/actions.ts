"use server";

import { updateTag } from "next/cache";

import { getAdminSession } from "@/core/auth";
import { APIBadStatusError } from "@/core/errors";
import { ADMIN_FORBIDDEN, runAdminMutation, VALIDATION_FAILED } from "@/shared/utils/adminMutation";
import { buildRefusal } from "@/shared/utils/refusal";
import { toFieldErrors } from "@/shared/utils/validation";

import { deleteSpielort, patchSpielort, postSpielort, reactivateSpielort } from "./mutations";
import { FLPatchSpielortPayloadSchema, FLPostSpielortPayloadSchema, FLSpielortKeyPayloadSchema } from "./schemas";

import type { FLSpielortPayloadDraft } from "@/features/spielorte/schemas";
import type { FieldErrors } from "@/shared/utils/validation";
import type { FLPatchSpielortPayload, FLPostSpielortPayload, FLSpielort, FLSpielortKeyPayload } from "./schemas";

/**
 * The retirement refusal, or `null` when the 409 is something else. It lands on no field: the retire
 * control is a dialog rather than a form.
 */
function mapRetireRefusal(error: unknown): { error?: string; fieldErrors?: FieldErrors } | null {
  if (!(error instanceof APIBadStatusError) || error.statusCode !== 409) return null;

  if (error.serverErrorCode === "REQ-RETIRE-003") {
    return {
      error:
        "Für diesen Spielort sind noch Spiele angesetzt, die kein Ergebnis haben. Verlege diese Spiele auf einen anderen Spielort oder sage sie ab.",
    };
  }
  return null;
}

export async function postSpielortAction(
  // The DRAFT shape: an emptied money field submits `null`, and the schema below is what turns that into a
  // field error rather than a type error.
  rawPayload: FLSpielortPayloadDraft<FLPostSpielortPayload>,
): Promise<{ success: boolean; created_id?: string; message?: string; error?: string; fieldErrors?: FieldErrors }> {
  return runAdminMutation("postSpielortAction", async () => {
    if (!(await getAdminSession())) {
      return { success: false, error: ADMIN_FORBIDDEN };
    }

    const validated = FLPostSpielortPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return {
        success: false,
        error: VALIDATION_FAILED,
        fieldErrors: toFieldErrors(validated.error),
      };
    }

    const postOperation = await postSpielort(validated.data);
    if (!postOperation.acknowledged) {
      return { success: false, error: buildRefusal({ reason: "Der Spielort wurde nicht angelegt", repair: "Versuche es erneut" }) };
    }

    return { success: Boolean(postOperation.acknowledged), created_id: postOperation.created_id, message: "Spielort angelegt" };
  });
}

export async function patchSpielortAction(
  // The DRAFT shape: an emptied money field submits `null`, and the schema below is what turns that into a
  // field error rather than a type error.
  rawPayload: FLSpielortPayloadDraft<FLPatchSpielortPayload>,
): Promise<{ success: boolean; updated_document?: FLSpielort; message?: string; error?: string; fieldErrors?: FieldErrors }> {
  return runAdminMutation("patchSpielortAction", async () => {
    if (!(await getAdminSession())) {
      return { success: false, error: ADMIN_FORBIDDEN };
    }

    const validated = FLPatchSpielortPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return {
        success: false,
        error: VALIDATION_FAILED,
        fieldErrors: toFieldErrors(validated.error),
      };
    }

    const patchOperation = await patchSpielort(validated.data);
    if (!patchOperation.acknowledged) {
      return { success: false, error: buildRefusal({ reason: "Die Spielortdaten wurden nicht gespeichert", repair: "Versuche es erneut" }) };
    }

    // A rename fans into every match embedding this venue, which is the one cached read it reaches.
    updateTag("spiele");

    return {
      success: Boolean(patchOperation.acknowledged),
      updated_document: patchOperation.updated_document,
      message: "Spielort bearbeitet",
    };
  });
}

export async function deleteSpielortAction(
  rawPayload: FLSpielortKeyPayload,
): Promise<{ success: boolean; updated_document?: FLSpielort; message?: string; error?: string; fieldErrors?: FieldErrors }> {
  return runAdminMutation("deleteSpielortAction", async () => {
    if (!(await getAdminSession())) {
      return { success: false, error: ADMIN_FORBIDDEN };
    }

    const validated = FLSpielortKeyPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return {
        success: false,
        error: VALIDATION_FAILED,
        fieldErrors: toFieldErrors(validated.error),
      };
    }

    // The refusal belongs in the dialog rather than on the error page.
    let patchOperation;
    try {
      patchOperation = await deleteSpielort(validated.data);
    } catch (error) {
      const refusal = mapRetireRefusal(error);
      if (refusal) return { success: false, ...refusal };
      throw error;
    }

    if (!patchOperation.acknowledged) {
      return { success: false, error: buildRefusal({ reason: "Der Spielort wurde nicht stillgelegt", repair: "Versuche es erneut" }) };
    }

    return {
      success: Boolean(patchOperation.acknowledged),
      updated_document: patchOperation.updated_document,
      message: "Spielort stillgelegt. Seine Spiele bleiben erhalten.",
    };
  });
}

/**
 * Nothing to invalidate, unlike the patch: this write moves only `inactive_since`, which no match
 * document carries. The endpoint refuses nothing — a venue coming back takes no fixtures with it.
 */
export async function reactivateSpielortAction(
  rawPayload: FLSpielortKeyPayload,
): Promise<{ success: boolean; updated_document?: FLSpielort; message?: string; error?: string; fieldErrors?: FieldErrors }> {
  return runAdminMutation("reactivateSpielortAction", async () => {
    if (!(await getAdminSession())) {
      return { success: false, error: ADMIN_FORBIDDEN };
    }

    const validated = FLSpielortKeyPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return {
        success: false,
        error: VALIDATION_FAILED,
        fieldErrors: toFieldErrors(validated.error),
      };
    }

    const reactivateOperation = await reactivateSpielort(validated.data);
    if (!reactivateOperation.acknowledged) {
      return { success: false, error: buildRefusal({ reason: "Der Spielort wurde nicht reaktiviert", repair: "Versuche es erneut" }) };
    }

    return {
      success: Boolean(reactivateOperation.acknowledged),
      updated_document: reactivateOperation.updated_document,
      message: "Spielort reaktiviert",
    };
  });
}
