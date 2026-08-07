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
 *   • **Two 409s, and neither is about a unique index.** No field of a matchday is unique and none needs
 *     to be -- its place in the season is derived (ADR-0064), so there is no position to claim. Both
 *     refusals are about the matchday's CONTENTS, which it does not know about: retiring one that holds a
 *     played result would take that result off the public Spielplan (`REQ-RETIRE-002`), and a phase
 *     accounting for fewer matches than are attached would strand them (`REQ-SPIELTAG-002`).
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

import { deleteSpieltag, patchSpieltag, postSpieltag, reactivateSpieltag } from "./mutations";
import { FLPatchSpieltagPayloadSchema, FLPostSpieltagPayloadSchema, FLSpieltagKeyPayloadSchema } from "./schemas";

import type { FieldErrors } from "@/shared/utils/validation";
import type { FLPatchSpieltagPayload, FLSpieltagKeyPayload, FLSpieltagWriteResponse } from "./schemas";
import type { SpieltagCreateDraft } from "./types";

const VALIDATION_FAILED = "Bitte überprüfe deine Eingaben!";

/**
 * The two matchday refusals in German, or `null` when the 409 is neither.
 *
 * `REQ-SPIELTAG-002` lands on `saison_phase`, the field that caused it; `REQ-RETIRE-002` has no field to
 * land on -- the retire control is a dialog, not a form -- so it comes back as the dialog's error.
 */
function mapSpieltagRefusal(error: unknown): { error?: string; fieldErrors?: FieldErrors } | null {
  if (!(error instanceof APIBadStatusError) || error.statusCode !== 409) return null;

  if (error.serverErrorCode === "REQ-RETIRE-002") {
    return {
      error:
        "Dieser Spieltag hat schon gespielte Partien. Stillgelegt würde er samt Ergebnissen aus dem öffentlichen Spielplan verschwinden — trage die Spiele auf einen anderen Spieltag um oder sage sie ab.",
    };
  }
  if (error.serverErrorCode === "REQ-SPIELTAG-002") {
    return {
      fieldErrors: {
        saison_phase: "In dieser Phase sind weniger Spiele vorgesehen, als dieser Spieltag schon enthält.",
      },
    };
  }
  return null;
}

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

    // The phase is refused if the matchday already holds more fixtures than it accounts for
    // (`REQ-SPIELTAG-002`), which lands on the phase field in the dialog that is still open.
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

// Soft: the backend stamps `inactive_since` and removes nothing (ADR-0032). Its matches are left alone
// and stay resolvable, which is the reason this is not a delete — but they do leave the public Spielplan
// with the matchday, which is why a matchday holding a RESULT is refused (`REQ-RETIRE-002`).
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

    // The retirement is refused while the matchday holds a result (`REQ-RETIRE-002`). It reaches the
    // dialog rather than the error page, because the dialog is where the decision is being taken.
    let deleteOperation;
    try {
      deleteOperation = await deleteSpieltag(validated.data);
    } catch (error) {
      const refusal = mapSpieltagRefusal(error);
      if (refusal) return { success: false, ...refusal };
      throw error;
    }

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
