"use server";

import { updateTag } from "next/cache";

import { getAdminSession } from "@/core/auth";
import { APIBadStatusError } from "@/core/errors";
import { ADMIN_FORBIDDEN, runAdminMutation, VALIDATION_FAILED } from "@/shared/utils/adminMutation";
import { toFieldErrors } from "@/shared/utils/validation";

import { deleteSchiedsrichter, patchSchiedsrichter, postSchiedsrichter, reactivateSchiedsrichter } from "./mutations";
import { FLPatchSchiedsrichterPayloadSchema, FLPostSchiedsrichterPayloadSchema, FLSchiedsrichterKeyPayloadSchema } from "./schemas";

import type { FieldErrors } from "@/shared/utils/validation";
import type { FLPatchSchiedsrichterPayload, FLPostSchiedsrichterPayload, FLSchiedsrichter, FLSchiedsrichterKeyPayload } from "./schemas";

/**
 * The retirement refusal, or `null` when the 409 is something else. It lands on no field: the retire
 * control is a dialog rather than a form.
 */
function mapRetireRefusal(error: unknown): { error?: string; fieldErrors?: FieldErrors } | null {
  if (!(error instanceof APIBadStatusError) || error.statusCode !== 409) return null;

  if (error.serverErrorCode === "REQ-RETIRE-004") {
    return {
      error: "Diese Person ist noch für Spiele eingeteilt, die kein Ergebnis haben. Teile die Spiele jemand anderem zu oder sage sie ab.",
    };
  }
  return null;
}

export async function postSchiedsrichterAction(
  rawPayload: FLPostSchiedsrichterPayload,
): Promise<{ success: boolean; created_id?: string; message?: string; error?: string; fieldErrors?: FieldErrors }> {
  return runAdminMutation("postSchiedsrichterAction", async () => {
    if (!(await getAdminSession())) {
      return { success: false, error: ADMIN_FORBIDDEN };
    }

    const validated = FLPostSchiedsrichterPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return {
        success: false,
        error: VALIDATION_FAILED,
        fieldErrors: toFieldErrors(validated.error),
      };
    }

    const postOperation = await postSchiedsrichter(validated.data);
    if (!postOperation.acknowledged) {
      return { success: false, error: "Beim Anlegen des neuen Schiedsrichters ist ein unerwarteter Fehler aufgetreten" };
    }

    updateTag("schiedsrichter");

    return {
      success: Boolean(postOperation.acknowledged),
      created_id: postOperation.created_id,
      message: "Schiedsrichter erfolgreich angelegt!",
    };
  });
}

export async function patchSchiedsrichterAction(
  rawPayload: FLPatchSchiedsrichterPayload,
): Promise<{ success: boolean; updated_document?: FLSchiedsrichter; message?: string; error?: string; fieldErrors?: FieldErrors }> {
  return runAdminMutation("patchSchiedsrichterAction", async () => {
    if (!(await getAdminSession())) {
      return { success: false, error: ADMIN_FORBIDDEN };
    }

    const validated = FLPatchSchiedsrichterPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return {
        success: false,
        error: VALIDATION_FAILED,
        fieldErrors: toFieldErrors(validated.error),
      };
    }

    const postOperation = await patchSchiedsrichter(validated.data);
    if (!postOperation.acknowledged) {
      return { success: false, error: "Beim Bearbeiten der Schiedsrichter-Daten ist ein unerwarteter Fehler aufgetreten" };
    }

    updateTag("schiedsrichter");
    // A rename fans the name into every match; a match keeps its own fee.
    updateTag("spiele");

    return {
      success: Boolean(postOperation.acknowledged),
      updated_document: postOperation.updated_document,
      message: "Schiedsrichter erfolgreich bearbeitet!",
    };
  });
}

export async function deleteSchiedsrichterAction(
  rawPayload: FLSchiedsrichterKeyPayload,
): Promise<{ success: boolean; updated_document?: FLSchiedsrichter; message?: string; error?: string; fieldErrors?: FieldErrors }> {
  return runAdminMutation("deleteSchiedsrichterAction", async () => {
    if (!(await getAdminSession())) {
      return { success: false, error: ADMIN_FORBIDDEN };
    }

    const validated = FLSchiedsrichterKeyPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return {
        success: false,
        error: VALIDATION_FAILED,
        fieldErrors: toFieldErrors(validated.error),
      };
    }

    // The refusal belongs in the dialog that asked, not on the error page.
    let postOperation;
    try {
      postOperation = await deleteSchiedsrichter(validated.data);
    } catch (error) {
      const refusal = mapRetireRefusal(error);
      if (refusal) return { success: false, ...refusal };
      throw error;
    }

    if (!postOperation.acknowledged) {
      return { success: false, error: "Beim Stilllegen des Schiedsrichters ist ein unerwarteter Fehler aufgetreten" };
    }

    updateTag("schiedsrichter");

    return {
      success: Boolean(postOperation.acknowledged),
      updated_document: postOperation.updated_document,
      message: "Schiedsrichter stillgelegt. Seine Spiele bleiben erhalten.",
    };
  });
}

/**
 * `schiedsrichter` alone, unlike the patch: this write moves only `inactive_since`, which no match
 * document carries. The endpoint refuses nothing — a referee coming back carries no fixtures.
 */
export async function reactivateSchiedsrichterAction(
  rawPayload: FLSchiedsrichterKeyPayload,
): Promise<{ success: boolean; updated_document?: FLSchiedsrichter; message?: string; error?: string; fieldErrors?: FieldErrors }> {
  return runAdminMutation("reactivateSchiedsrichterAction", async () => {
    if (!(await getAdminSession())) {
      return { success: false, error: ADMIN_FORBIDDEN };
    }

    const validated = FLSchiedsrichterKeyPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return {
        success: false,
        error: VALIDATION_FAILED,
        fieldErrors: toFieldErrors(validated.error),
      };
    }

    const reactivateOperation = await reactivateSchiedsrichter(validated.data);
    if (!reactivateOperation.acknowledged) {
      return { success: false, error: "Beim Reaktivieren des Schiedsrichters ist ein unerwarteter Fehler aufgetreten" };
    }

    updateTag("schiedsrichter");

    return {
      success: Boolean(reactivateOperation.acknowledged),
      updated_document: reactivateOperation.updated_document,
      message: "Schiedsrichter reaktiviert.",
    };
  });
}
