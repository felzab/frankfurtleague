"use server";

import { updateTag } from "next/cache";

import { getAdminSession } from "@/core/auth";
import { APIBadStatusError } from "@/core/errors";
import { ADMIN_FORBIDDEN, runAdminMutation, VALIDATION_FAILED } from "@/shared/utils/adminMutation";
import { toFieldErrors } from "@/shared/utils/validation";

import { patchSpieltag, postSpieltag } from "./mutations";
import { FLPatchSpieltagPayloadSchema, FLPostSpieltagPayloadSchema } from "./schemas";

import type { FieldErrors } from "@/shared/utils/validation";
import type { FLSpieltagWriteResponse } from "./schemas";
import type { SpieltagCreateDraft, SpieltagEditDraft } from "./types";

/** The six refusals a create or an edit can draw, in German, or `null` when none applies. */
function mapSpieltagRefusal(error: unknown): { error?: string; fieldErrors?: FieldErrors } | null {
  if (!(error instanceof APIBadStatusError) || error.statusCode !== 409) return null;

  // `uniq_saison_id_saison_phase_position`. The picker greys a taken slot out, so this is the race:
  // somebody else took the position between the page's read and this save.
  if (error.serverErrorCode === "DB-COMMON-002") {
    return { fieldErrors: { position: "Diese Position ist inzwischen vergeben. Lade die Seite neu und wähle eine freie." } };
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

    // A new matchday has no fixtures and picks no position, so only the span (`REQ-DATE-002`) and a
    // season whose knockout phase has already begun (`REQ-SPIELTAG-003`) can refuse it.
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
      // No name to echo: it is composed from the phase and the position, and the create answers with
      // an id alone rather than the document that would carry the position the server picked.
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
