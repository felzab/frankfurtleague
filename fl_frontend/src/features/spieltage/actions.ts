"use server";

/**
 * SPIELTAGE · server actions
 *
 * Full CRUD over matchdays, retirement included. The `"use server"` directive stays the first
 * line, above this block.
 *
 * Invariants:
 * - Every action checks `getAdminSession()` and runs in `runAdminMutation` (docs/logging/error-codes.md).
 * - Base tag only — the admin list and the public Spielplan span differently, so no granular tag
 *   names one write.
 * - `spieltage` is the only resource invalidated — `GET /spiele` never joins `spieltage`.
 * - Seven 409s and none is a unique index: four guard the matchday's contents and three its
 *   container; a matchday's place and name are derived, so there is nothing to claim.
 *
 * See:
 * - docs/frontend/spec.md — section 1.3, the action inventory
 */
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
 * The seven matchday refusals in German, or `null` when the 409 is none of them.
 *
 * Written to the shapes stated in `fl_frontend/src/features/saisons/actions.ts`. Three land on a field and
 * are one sentence about that value: `REQ-SPIELTAG-002` and `REQ-SPIELTAG-004` on `saison_phase`, and
 * `REQ-DATE-002` on `beginn`, which is the earlier of the two dates and so the one to look at first. The
 * others have no field to land on -- the two retirement refusals are raised from a control rather than a
 * form, `REQ-DATE-003` is about FIXTURES this form does not show, and `REQ-SPIELTAG-003` is about the
 * SEASON's own schedule -- so each is two sentences with the action second.
 *
 * **The `beginn` field error serves the create and the edit alone.** `reactivateSpieltagAction` answers the
 * same `REQ-DATE-002` from a row button with no form behind it, so it maps that code itself rather than
 * handing back a field error with no field to land on.
 */
function mapSpieltagRefusal(error: unknown): { error?: string; fieldErrors?: FieldErrors } | null {
  if (!(error instanceof APIBadStatusError) || error.statusCode !== 409) return null;

  if (error.serverErrorCode === "REQ-RETIRE-002") {
    return {
      error:
        "Dieser Spieltag hat gespielte Partien und würde samt ihren Ergebnissen aus dem öffentlichen Spielplan verschwinden. Verschiebe die Spiele auf einen anderen Spieltag oder sage sie ab.",
    };
  }
  // The phase's floor, refused from the container's side. No field to land on -- the count is a fact
  // about the phase rather than about any control on the form.
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
      return { success: false, error: ADMIN_FORBIDDEN };
    }

    const validated = FLPostSpieltagPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return { success: false, error: VALIDATION_FAILED, fieldErrors: toFieldErrors(validated.error) };
    }

    // The create has two refusals of its own: a span outside the season it names (`REQ-DATE-002`), and a
    // season whose knockout phase has already begun (`REQ-SPIELTAG-003`). The other three are about
    // fixtures, and a new matchday has none.
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
      // No name to echo: one is composed by the reader from the phase and the position, and
      // the position is only known once this matchday is in the list beside its siblings.
      message: "Spieltag angelegt.",
    };
  });
}

export async function patchSpieltagAction(
  // The DRAFT shape, not the parsed payload, exactly as the create takes: the page-owned editor may
  // submit `saison_phase: null` from a cleared picker, and the schema below is what turns that into a
  // field error rather than a type error.
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

// Soft: the backend stamps `inactive_since` and removes nothing. Its matches stay
// resolvable, but they leave the public Spielplan with the matchday, which is why one holding a
// result is refused (`REQ-RETIRE-002`).
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
      return { success: false, error: ADMIN_FORBIDDEN };
    }

    const validated = FLSpieltagKeyPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return { success: false, error: VALIDATION_FAILED, fieldErrors: toFieldErrors(validated.error) };
    }

    // The span is re-checked on the way back in (`REQ-DATE-002`): while it was retired the season's
    // dates were free to move past it. This lands on a toast, not a form, so the sentence carries its
    // own repair — a field error would have no field to land on.
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
