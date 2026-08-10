"use server";

/**
 * SPIELORTE · server actions
 *
 * Full CRUD over venues. The `"use server"` directive stays the first line, above this block.
 *
 * Invariants:
 * - Every action checks `getAdminSession()` and runs in `runAdminMutation` — a 409 reaches the toast.
 * - The patch invalidates `spiele` too: a venue rename fans into every match embedding it.
 * - Delete is a soft delete server-side — the action is named `delete…` but nothing is removed.
 * - Errors come back as `FormState` with German field-level messages, never exceptions.
 *
 * See:
 * - docs/frontend/spec.md — section 1.3, the action inventory
 */
import { updateTag } from "next/cache";

import { getAdminSession } from "@/core/auth";
import { APIBadStatusError } from "@/core/errors";
import { runAdminMutation, VALIDATION_FAILED } from "@/shared/utils/adminMutation";
import { toFieldErrors } from "@/shared/utils/validation";

import { deleteSpielort, patchSpielort, postSpielort } from "./mutations";
import { FLDeleteSpielortPayloadSchema, FLPatchSpielortPayloadSchema, FLPostSpielortPayloadSchema } from "./schemas";

import type { FieldErrors } from "@/shared/utils/validation";
import type { FLDeleteSpielortPayload, FLPatchSpielortPayload, FLPostSpielortPayload, FLSpielort } from "./schemas";

/**
 * The retirement refusal (`REQ-RETIRE-003`), or `null` when the 409 is something else.
 *
 * Two sentences to the shape in `fl_frontend/src/features/saisons/actions.ts`: the retire control is a
 * dialog rather than a form, so there is no field for this to land on and the action goes second.
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
  rawPayload: FLPostSpielortPayload,
): Promise<{ success: boolean; created_id?: string; message?: string; error?: string; fieldErrors?: FieldErrors }> {
  return runAdminMutation("postSpielortAction", async () => {
    if (!(await getAdminSession())) {
      return { success: false, error: "Access Denied: Admin privileges missing" };
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
      return { success: false, error: "Beim Anlegen des neuen Spielortes ist ein unerwarteter Fehler aufgetreten" };
    }

    updateTag("spielorte");

    return { success: Boolean(postOperation.acknowledged), created_id: postOperation.created_id, message: "Spielort erfolgreich angelegt!" };
  });
}

export async function patchSpielortAction(
  rawPayload: FLPatchSpielortPayload,
): Promise<{ success: boolean; updated_document?: FLSpielort; message?: string; error?: string; fieldErrors?: FieldErrors }> {
  return runAdminMutation("patchSpielortAction", async () => {
    if (!(await getAdminSession())) {
      return { success: false, error: "Access Denied: Admin privileges missing" };
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
      return { success: false, error: "Beim Bearbeiten der Spielort-Daten ist ein unerwarteter Fehler aufgetreten" };
    }

    updateTag("spielorte");
    updateTag("spiele");

    return {
      success: Boolean(patchOperation.acknowledged),
      updated_document: patchOperation.updated_document,
      message: "Spielort erfolgreich bearbeitet!",
    };
  });
}

export async function deleteSpielortAction(
  rawPayload: FLDeleteSpielortPayload,
): Promise<{ success: boolean; updated_document?: FLSpielort; message?: string; error?: string; fieldErrors?: FieldErrors }> {
  return runAdminMutation("deleteSpielortAction", async () => {
    if (!(await getAdminSession())) {
      return { success: false, error: "Access Denied: Admin privileges missing" };
    }

    const validated = FLDeleteSpielortPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return {
        success: false,
        error: VALIDATION_FAILED,
        fieldErrors: toFieldErrors(validated.error),
      };
    }

    // The retirement is refused while an unplayed fixture is still booked here (`REQ-RETIRE-003`), and
    // that answer belongs in the dialog rather than on the error page.
    let patchOperation;
    try {
      patchOperation = await deleteSpielort(validated.data);
    } catch (error) {
      const refusal = mapRetireRefusal(error);
      if (refusal) return { success: false, ...refusal };
      throw error;
    }

    if (!patchOperation.acknowledged) {
      return { success: false, error: "Beim löschen der Spielort-Daten ist ein unerwarteter Fehler aufgetreten" };
    }

    updateTag("spielorte");

    return {
      success: Boolean(patchOperation.acknowledged),
      updated_document: patchOperation.updated_document,
      message: "Spielort erfolgreich gelöscht!",
    };
  });
}
