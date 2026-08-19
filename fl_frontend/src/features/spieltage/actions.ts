"use server";

import { updateTag } from "next/cache";

import { getAdminSession } from "@/core/auth";
import { APIBadStatusError } from "@/core/errors";
import { ADMIN_FORBIDDEN, runAdminMutation, VALIDATION_FAILED } from "@/shared/utils/adminMutation";
import { toFieldErrors } from "@/shared/utils/validation";

import { deleteSpieltag, patchSpieltag, postSpieltag, reactivateSpieltag } from "./mutations";
import { FLPatchSpieltagPayloadSchema, FLPostSpieltagPayloadSchema, FLSpieltagKeyPayloadSchema } from "./schemas";

import type { FieldErrors } from "@/shared/utils/validation";
import type { FLSpieltagKeyPayload, FLSpieltagWriteResponse } from "./schemas";
import type { SpieltagCreateDraft, SpieltagEditDraft } from "./types";

/**
 * The seven refusals in German, or `null` when none applies. **The `beginn` field error serves the
 * create and the edit alone**: `reactivateSpieltagAction` answers `REQ-DATE-002` from a row button
 * with no field to land on, so it maps that code itself.
 */
function mapSpieltagRefusal(error: unknown): { error?: string; fieldErrors?: FieldErrors } | null {
  if (!(error instanceof APIBadStatusError) || error.statusCode !== 409) return null;

  if (error.serverErrorCode === "REQ-RETIRE-002") {
    return {
      error:
        "Dieser Spieltag hat gespielte Partien und würde samt ihren Ergebnissen aus dem öffentlichen Spielplan verschwinden. Verschiebe die Spiele auf einen anderen Spieltag oder sage sie ab.",
    };
  }
  // No field to land on: the count is a fact about the phase, not about a control on the form.
  if (error.serverErrorCode === "REQ-RETIRE-005") {
    return {
      error:
        "Diese Phase hätte danach weniger Spieltage, als die Regeln der Saison vorsehen. Lege zuerst einen weiteren Spieltag dieser Phase an, oder passe die Regeln der Saison an.",
    };
  }
  if (error.serverErrorCode === "REQ-SPIELTAG-002") {
    return { fieldErrors: { saison_phase: "In dieser Phase sind weniger Spiele vorgesehen, als dieser Spieltag enthält." } };
  }
  if (error.serverErrorCode === "REQ-SPIELTAG-004") {
    return { fieldErrors: { saison_phase: "Diese Runde spielt die Saison nach ihren Regeln gar nicht." } };
  }
  if (error.serverErrorCode === "REQ-SPIELTAG-003") {
    return {
      error:
        "Die KO-Runde dieser Saison hat schon begonnen, deshalb lassen sich keine Spieltage mehr anlegen. Verschiebe den Beginn der KO-Runde oder wähle eine andere Saison.",
    };
  }
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

export async function postSpieltagAction(
  // The DRAFT shape, not the parsed payload: the form may submit `saison_phase: null` from an
  // untouched picker, and the schema below turns that into a field error rather than a type error.
  rawPayload: SpieltagCreateDraft,
): Promise<{ success: boolean; spieltag_id?: string; message?: string; error?: string; fieldErrors?: FieldErrors }> {
  return runAdminMutation("postSpieltagAction", async () => {
    if (!(await getAdminSession())) {
      return { success: false, error: ADMIN_FORBIDDEN };
    }

    const validated = FLPostSpieltagPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return { success: false, error: VALIDATION_FAILED, fieldErrors: toFieldErrors(validated.error) };
    }

    // A new matchday has no fixtures, so only the span (`REQ-DATE-002`) and a season whose knockout
    // phase has already begun (`REQ-SPIELTAG-003`) can refuse it.
    let postOperation;
    try {
      postOperation = await postSpieltag(validated.data);
    } catch (error) {
      const refusal = mapSpieltagRefusal(error);
      if (refusal) return { success: false, error: refusal.error ?? VALIDATION_FAILED, fieldErrors: refusal.fieldErrors };
      throw error;
    }

    if (!postOperation.acknowledged) {
      return { success: false, error: "Beim Anlegen des neuen Spieltags ist ein unerwarteter Fehler aufgetreten" };
    }

    invalidateSpieltage();

    return {
      success: true,
      spieltag_id: postOperation.spieltag_id,
      // No name to echo: one is composed from the phase and the position, and the position is only
      // known once this matchday is in the list beside its siblings.
      message: "Spieltag angelegt.",
    };
  });
}

export async function patchSpieltagAction(
  // The DRAFT shape, not the parsed payload, exactly as the create takes.
  rawPayload: SpieltagEditDraft,
): Promise<{
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

    // `REQ-SPIELTAG-002` lands on the phase field in the dialog that is still open.
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

// A retirement takes the matchday's fixtures off the public Spielplan with it, which is why one
// holding a result is refused (`REQ-RETIRE-002`).
export async function deleteSpieltagAction(rawPayload: FLSpieltagKeyPayload): Promise<{
  success: boolean;
  spieltag?: FLSpieltagWriteResponse;
  message?: string;
  error?: string;
  fieldErrors?: FieldErrors;
}> {
  return runAdminMutation("deleteSpieltagAction", async () => {
    if (!(await getAdminSession())) {
      return { success: false, error: ADMIN_FORBIDDEN };
    }

    const validated = FLSpieltagKeyPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return { success: false, error: VALIDATION_FAILED, fieldErrors: toFieldErrors(validated.error) };
    }

    // Reaches the dialog rather than the error page: the dialog is where the decision is being taken.
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
      return { success: false, error: ADMIN_FORBIDDEN };
    }

    const validated = FLSpieltagKeyPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return { success: false, error: VALIDATION_FAILED, fieldErrors: toFieldErrors(validated.error) };
    }

    // The span is re-checked on the way back in (`REQ-DATE-002`): while it was retired the season's
    // dates were free to move past it. This lands on a toast, so the sentence carries its own repair.
    let reactivateOperation;
    try {
      reactivateOperation = await reactivateSpieltag(validated.data);
    } catch (error) {
      if (error instanceof APIBadStatusError && error.statusCode === 409 && error.serverErrorCode === "REQ-DATE-002") {
        return {
          success: false,
          error:
            "Der Zeitraum dieses Spieltags liegt außerhalb des Zeitraums der Saison. Passe den Zeitraum des Spieltags oder der Saison an und reaktiviere ihn danach.",
        };
      }
      throw error;
    }

    if (!reactivateOperation.acknowledged) {
      return { success: false, error: "Beim Reaktivieren des Spieltags ist ein unerwarteter Fehler aufgetreten" };
    }

    invalidateSpieltage();

    return { success: true, spieltag: reactivateOperation, message: "Spieltag reaktiviert." };
  });
}
