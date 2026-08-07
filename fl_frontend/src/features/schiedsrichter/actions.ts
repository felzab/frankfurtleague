"use server";

/**
 * SCHIEDSRICHTER · server actions
 *
 * Full CRUD over referees. The `"use server"` directive stays the first line, above this block.
 *
 *  INVARIANTS ───────────────────────────────────────────────────────────────────────────────────────────
 *
 *   • Every action body runs inside `runAdminMutation`, which seeds the correlation-id request scope
 *     and converts a thrown API error into the returned result -- a 409 must reach the form's toast,
 *     not the error page (docs/logging.md).
 *   • Every action begins with `getAdminSession()` and CHECKS the result.
 *   • The patch action invalidates `spiele` as well as `schiedsrichter`, because the backend fans the
 *     new name into every match embedding it. Note it fans out the NAME only — a match keeps the fee
 *     that was agreed for it.
 *   • Delete is a soft delete server-side.
 *
 *  SEE ALSO ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 *   docs/frontend/spec.md — section 3, the action inventory
 */
import { updateTag } from "next/cache";

import { getAdminSession } from "@/core/auth";
import { APIBadStatusError } from "@/core/errors";
import { runAdminMutation } from "@/shared/utils/adminMutation";
import { toFieldErrors } from "@/shared/utils/validation";

import { deleteSchiedsrichter, patchSchiedsrichter, postSchiedsrichter } from "./mutations";
import { FLDeleteSchiedsrichterPayloadSchema, FLPatchSchiedsrichterPayloadSchema, FLPostSchiedsrichterPayloadSchema } from "./schemas";

import type { FieldErrors } from "@/shared/utils/validation";
import type { FLDeleteSchiedsrichterPayload, FLPatchSchiedsrichterPayload, FLPostSchiedsrichterPayload, FLSchiedsrichter } from "./schemas";

/**
 * The retirement refusal (`REQ-RETIRE-004`), or `null` when the 409 is something else.
 *
 * Two sentences to the shape in `fl_frontend/src/features/saisons/actions.ts`: the retire control is a
 * dialog rather than a form, so there is no field for this to land on and the action goes second.
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
      return { success: false, error: "Access Denied: Admin privileges missing" };
    }

    const validated = FLPostSchiedsrichterPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return {
        success: false,
        error: "Bitte überprüfe deine Eingaben!",
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
      return { success: false, error: "Access Denied: Admin privileges missing" };
    }

    const validated = FLPatchSchiedsrichterPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return {
        success: false,
        error: "Bitte überprüfe deine Eingaben!",
        fieldErrors: toFieldErrors(validated.error),
      };
    }

    const postOperation = await patchSchiedsrichter(validated.data);
    if (!postOperation.acknowledged) {
      return { success: false, error: "Beim Bearbeiten der Schiedsrichter-Daten ist ein unerwarteter Fehler aufgetreten" };
    }

    updateTag("schiedsrichter");
    updateTag("spiele");

    return {
      success: Boolean(postOperation.acknowledged),
      updated_document: postOperation.updated_document,
      message: "Schiedsrichter erfolgreich bearbeitet!",
    };
  });
}

// This is a soft delete
export async function deleteSchiedsrichterAction(
  rawPayload: FLDeleteSchiedsrichterPayload,
): Promise<{ success: boolean; updated_document?: FLSchiedsrichter; message?: string; error?: string; fieldErrors?: FieldErrors }> {
  return runAdminMutation("deleteSchiedsrichterAction", async () => {
    if (!(await getAdminSession())) {
      return { success: false, error: "Access Denied: Admin privileges missing" };
    }

    const validated = FLDeleteSchiedsrichterPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return {
        success: false,
        error: "Bitte überprüfe deine Eingaben!",
        fieldErrors: toFieldErrors(validated.error),
      };
    }

    // Refused while they are still assigned to an unplayed fixture (`REQ-RETIRE-004`), answered in the
    // dialog that asked.
    let postOperation;
    try {
      postOperation = await deleteSchiedsrichter(validated.data);
    } catch (error) {
      const refusal = mapRetireRefusal(error);
      if (refusal) return { success: false, ...refusal };
      throw error;
    }

    if (!postOperation.acknowledged) {
      return { success: false, error: "Beim Löschen der Schiedsrichter-Daten ist ein unerwarteter Fehler aufgetreten" };
    }

    updateTag("schiedsrichter");

    return {
      success: Boolean(postOperation.acknowledged),
      updated_document: postOperation.updated_document,
      message: "Schiedsrichter erfolgreich gelöscht!",
    };
  });
}
