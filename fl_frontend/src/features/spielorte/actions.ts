"use server";

/**
 * SPIELORTE · server actions
 *
 * Full CRUD over venues. The `"use server"` directive stays the first line, above this block.
 *
 *  INVARIANTS ───────────────────────────────────────────────────────────────────────────────────────────
 *
 *   • Every action begins with `getAdminSession()` and CHECKS the result. It neither throws nor
 *     redirects, so calling it bare guards nothing.
 *   • The patch action invalidates `spiele` as well as `spielorte`: the backend fans a venue rename
 *     into every match embedding it, so match data really has changed.
 *   • Delete is a soft delete server-side. The action is named `delete…` but nothing is removed.
 *   • Errors come back as `FormState` rather than exceptions, with German field-level messages.
 *
 *  SEE ALSO ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 *   docs/frontend/spec.md — section 3, the action inventory
 */
import { updateTag } from "next/cache";

import { getAdminSession } from "@/core/auth";
import { toFieldErrors } from "@/shared/utils/validation";

import { deleteSpielort, patchSpielort, postSpielort } from "./mutations";
import { FLDeleteSpielortPayloadSchema, FLPatchSpielortPayloadSchema, FLPostSpielortPayloadSchema } from "./schemas";

import type { FieldErrors } from "@/shared/utils/validation";
import type { FLDeleteSpielortPayload, FLPatchSpielortPayload, FLPostSpielortPayload, FLSpielort } from "./schemas";

export async function postSpielortAction(
  rawPayload: FLPostSpielortPayload,
): Promise<{ success: boolean; created_id?: string; message?: string; error?: string; fieldErrors?: FieldErrors }> {
  if (!(await getAdminSession())) {
    return { success: false, error: "Access Denied: Admin privileges missing" };
  }

  const validated = FLPostSpielortPayloadSchema.safeParse(rawPayload);

  if (!validated.success) {
    return {
      success: false,
      error: "Bitte überprüfe deine Eingaben!",
      fieldErrors: toFieldErrors(validated.error),
    };
  }

  const postOperation = await postSpielort(validated.data);
  if (!postOperation.acknowledged) {
    return { success: false, error: "Beim Anlegen des neuen Spielortes ist ein unerwarteter Fehler aufgetreten" };
  }

  updateTag("spielorte");

  return { success: Boolean(postOperation.acknowledged), created_id: postOperation.created_id, message: "Spielort erfolgreich angelegt!" };
}

export async function patchSpielortAction(
  rawPayload: FLPatchSpielortPayload,
): Promise<{ success: boolean; updated_document?: FLSpielort; message?: string; error?: string; fieldErrors?: FieldErrors }> {
  if (!(await getAdminSession())) {
    return { success: false, error: "Access Denied: Admin privileges missing" };
  }

  const validated = FLPatchSpielortPayloadSchema.safeParse(rawPayload);

  if (!validated.success) {
    return {
      success: false,
      error: "Bitte überprüfe deine Eingaben!",
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
}

// This is a soft delete
export async function deleteSpielortAction(
  rawPayload: FLDeleteSpielortPayload,
): Promise<{ success: boolean; updated_document?: FLSpielort; message?: string; error?: string; fieldErrors?: FieldErrors }> {
  if (!(await getAdminSession())) {
    return { success: false, error: "Access Denied: Admin privileges missing" };
  }

  const validated = FLDeleteSpielortPayloadSchema.safeParse(rawPayload);

  if (!validated.success) {
    return {
      success: false,
      error: "Bitte überprüfe deine Eingaben!",
      fieldErrors: toFieldErrors(validated.error),
    };
  }

  const patchOperation = await deleteSpielort(validated.data);
  if (!patchOperation.acknowledged) {
    return { success: false, error: "Beim löschen der Spielort-Daten ist ein unerwarteter Fehler aufgetreten" };
  }

  updateTag("spielorte");

  return {
    success: Boolean(patchOperation.acknowledged),
    updated_document: patchOperation.updated_document,
    message: "Spielort erfolgreich gelöscht!",
  };
}
