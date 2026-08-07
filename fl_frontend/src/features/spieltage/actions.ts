"use server";

/**
 * SPIELTAGE · server actions
 *
 * Full CRUD over matchdays, retirement included. The `"use server"` directive stays the first line,
 * above this block.
 *
 *  INVARIANTS ───────────────────────────────────────────────────────────────────────────────────────────
 *
 *   • Every action body runs inside `runAdminMutation`, which seeds the correlation-id request scope
 *     and converts a thrown API error into the returned result (docs/logging.md).
 *   • Every action begins with `getAdminSession()` and CHECKS the result.
 *   • Base tag only, on every action here. The admin list spans a season's matchdays including retired
 *     ones and the public Spielplan reads the default season, so no granular tag names what one write
 *     changes -- and a granular tag nothing invalidates is decoration (ADR-0001).
 *   • `spieltage` is the ONLY resource invalidated. A matchday joins into no second resource:
 *     `GET /spiele` never joins `spieltage`, which is the same fact that makes retirement safe.
 *   • There is no 409 branch anywhere here. Nothing about a matchday is unique -- not its name, not its
 *     `order_val` -- so no write can collide, which is exactly why the list marks a duplicate
 *     `order_val` rather than relying on a refusal that will never come.
 *
 *  SEE ALSO ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 *   docs/frontend/spec.md — section 3, the action inventory
 */
import { updateTag } from "next/cache";

import { getAdminSession } from "@/core/auth";
import { runAdminMutation } from "@/shared/utils/adminMutation";
import { toFieldErrors } from "@/shared/utils/validation";

import { deleteSpieltag, patchSpieltag, postSpieltag, reactivateSpieltag } from "./mutations";
import { FLPatchSpieltagPayloadSchema, FLPostSpieltagPayloadSchema, FLSpieltagKeyPayloadSchema } from "./schemas";

import type { FieldErrors } from "@/shared/utils/validation";
import type { FLPatchSpieltagPayload, FLSpieltagKeyPayload, FLSpieltagWriteResponse } from "./schemas";
import type { SpieltagCreateDraft } from "./types";

const VALIDATION_FAILED = "Bitte überprüfe deine Eingaben!";

/** Every spieltage read, in one call. Base tag only, for the reason in this module's invariants. */
function invalidateSpieltage(): void {
  updateTag("spieltage");
}

export async function postSpieltagAction(
  // The DRAFT shape, not the parsed payload: the form may submit `saison_phase: null` from an
  // untouched picker, and the schema below is what turns that into a field error rather than a type
  // error.
  rawPayload: SpieltagCreateDraft,
): Promise<{ success: boolean; spieltag_id?: string; message?: string; error?: string; fieldErrors?: FieldErrors }> {
  return runAdminMutation("postSpieltagAction", async () => {
    if (!(await getAdminSession())) {
      return { success: false, error: "Access Denied: Admin privileges missing" };
    }

    const validated = FLPostSpieltagPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return { success: false, error: VALIDATION_FAILED, fieldErrors: toFieldErrors(validated.error) };
    }

    const postOperation = await postSpieltag(validated.data);
    if (!postOperation.acknowledged) {
      return { success: false, error: "Beim Anlegen des neuen Spieltags ist ein unerwarteter Fehler aufgetreten" };
    }

    invalidateSpieltage();

    return {
      success: true,
      spieltag_id: postOperation.spieltag_id,
      message: `Spieltag „${validated.data.name}“ angelegt.`,
    };
  });
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
      return { success: false, error: "Access Denied: Admin privileges missing" };
    }

    const validated = FLPatchSpieltagPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return { success: false, error: VALIDATION_FAILED, fieldErrors: toFieldErrors(validated.error) };
    }

    const patchOperation = await patchSpieltag(validated.data);
    if (!patchOperation.acknowledged) {
      return { success: false, error: "Bei der Bearbeitung des Spieltags ist ein unerwarteter Fehler aufgetreten" };
    }

    invalidateSpieltage();

    return { success: true, spieltag: patchOperation, message: "Spieltag gespeichert!" };
  });
}

// Soft: the backend stamps `inactive_since` and removes nothing (ADR-0032). The matchday's matches are
// left alone and stay readable, which is the reason this is not a delete.
export async function deleteSpieltagAction(rawPayload: FLSpieltagKeyPayload): Promise<{
  success: boolean;
  spieltag?: FLSpieltagWriteResponse;
  message?: string;
  error?: string;
  fieldErrors?: FieldErrors;
}> {
  return runAdminMutation("deleteSpieltagAction", async () => {
    if (!(await getAdminSession())) {
      return { success: false, error: "Access Denied: Admin privileges missing" };
    }

    const validated = FLSpieltagKeyPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return { success: false, error: VALIDATION_FAILED, fieldErrors: toFieldErrors(validated.error) };
    }

    const deleteOperation = await deleteSpieltag(validated.data);
    if (!deleteOperation.acknowledged) {
      return { success: false, error: "Beim Stilllegen des Spieltags ist ein unerwarteter Fehler aufgetreten" };
    }

    invalidateSpieltage();

    return {
      success: true,
      spieltag: deleteOperation,
      message: "Spieltag stillgelegt. Seine Spiele bleiben erhalten.",
    };
  });
}

export async function reactivateSpieltagAction(rawPayload: FLSpieltagKeyPayload): Promise<{
  success: boolean;
  spieltag?: FLSpieltagWriteResponse;
  message?: string;
  error?: string;
  fieldErrors?: FieldErrors;
}> {
  return runAdminMutation("reactivateSpieltagAction", async () => {
    if (!(await getAdminSession())) {
      return { success: false, error: "Access Denied: Admin privileges missing" };
    }

    const validated = FLSpieltagKeyPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return { success: false, error: VALIDATION_FAILED, fieldErrors: toFieldErrors(validated.error) };
    }

    const reactivateOperation = await reactivateSpieltag(validated.data);
    if (!reactivateOperation.acknowledged) {
      return { success: false, error: "Beim Reaktivieren des Spieltags ist ein unerwarteter Fehler aufgetreten" };
    }

    invalidateSpieltage();

    return { success: true, spieltag: reactivateOperation, message: "Spieltag reaktiviert." };
  });
}
