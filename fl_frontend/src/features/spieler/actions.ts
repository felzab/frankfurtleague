"use server";

import { updateTag } from "next/cache";

import { runAdminMutation } from "@/shared/utils/adminMutation";
import { buildRefusal } from "@/shared/utils/refusal";
import { toFieldErrors, VALIDATION_FAILED } from "@/shared/utils/validation";

import { RETIREMENT_KEEPS_SQUAD_ROWS } from "./constants";
import {
  deleteSaisonSpieler,
  deleteSpieler,
  eraseSpieler,
  patchSaisonSpieler,
  patchSpieler,
  postSaisonSpieler,
  reactivateSaisonSpieler,
  reactivateSpieler,
} from "./mutations";
import { mapAlreadyInSaisonRefusal, mapErasureRefusal, mapSquadRefusal } from "./refusals";
import {
  FLDeleteSpielerPayloadSchema,
  FLEraseSpielerPayloadSchema,
  FLPatchSaisonSpielerPayloadSchema,
  FLPatchSpielerPayloadSchema,
  FLPostSaisonSpielerPayloadSchema,
  FLReactivateSpielerPayloadSchema,
  FLSaisonSpielerKeyPayloadSchema,
} from "./schemas";
import { describeErasureUmfang } from "./utils";

import type { ActionResult } from "@/shared/types/types";
import type {
  FLDeleteSpielerPayload,
  FLEraseSpielerPayload,
  FLPatchSpielerPayload,
  FLReactivateSpielerPayload,
  FLSaisonSpielerKeyPayload,
  FLSaisonSpielerResponse,
  FLSpielerAdminSingleResponse,
  FLSpielerErasureResponse,
} from "./schemas";
import type { SaisonSpielerEnterDraft, SaisonSpielerMembershipDraft } from "./types";

/** Base tag only, for the reason `fl_frontend/src/features/spieler/queries.ts :: getSpieler` gives. */
function invalidateSpieler(): void {
  updateTag("spieler");
}

export async function patchSpielerAction(rawPayload: FLPatchSpielerPayload): Promise<ActionResult<{ spieler?: FLSpielerAdminSingleResponse }>> {
  return runAdminMutation("patchSpielerAction", { readOnly: false }, async () => {
    const validated = FLPatchSpielerPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return { success: false, error: VALIDATION_FAILED, fieldErrors: toFieldErrors(validated.error) };
    }

    const patchOperation = await patchSpieler(validated.data);
    if (!patchOperation.acknowledged) {
      return { success: false, error: buildRefusal({ reason: "Die Spielerdaten wurden nicht gespeichert", repair: "Versuche es erneut" }) };
    }

    invalidateSpieler();

    return {
      success: true,
      spieler: patchOperation,
      message: "Spieler bearbeitet",
    };
  });
}

export async function deleteSpielerAction(
  rawPayload: FLDeleteSpielerPayload,
): Promise<ActionResult<{ spieler?: FLSpielerAdminSingleResponse }>> {
  return runAdminMutation("deleteSpielerAction", { readOnly: false }, async () => {
    const validated = FLDeleteSpielerPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return { success: false, error: VALIDATION_FAILED, fieldErrors: toFieldErrors(validated.error) };
    }

    const deleteOperation = await deleteSpieler(validated.data);
    if (!deleteOperation.acknowledged) {
      return { success: false, error: buildRefusal({ reason: "Der Spieler wurde nicht stillgelegt", repair: "Versuche es erneut" }) };
    }

    invalidateSpieler();

    return {
      success: true,
      spieler: deleteOperation,
      message: RETIREMENT_KEEPS_SQUAD_ROWS,
    };
  });
}

export async function reactivateSpielerAction(
  rawPayload: FLReactivateSpielerPayload,
): Promise<ActionResult<{ spieler?: FLSpielerAdminSingleResponse }>> {
  return runAdminMutation("reactivateSpielerAction", { readOnly: false }, async () => {
    const validated = FLReactivateSpielerPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return { success: false, error: VALIDATION_FAILED, fieldErrors: toFieldErrors(validated.error) };
    }

    const reactivateOperation = await reactivateSpieler(validated.data);
    if (!reactivateOperation.acknowledged) {
      return { success: false, error: buildRefusal({ reason: "Der Spieler wurde nicht reaktiviert", repair: "Versuche es erneut" }) };
    }

    invalidateSpieler();

    return {
      success: true,
      spieler: reactivateOperation,
      message: "Spieler reaktiviert",
    };
  });
}

/**
 * Erases the person: their record, every squad row they hold and their values in the log, in one
 * transaction. **No undo is offered and none exists** — nothing writes the person back, and the log
 * deliberately keeps no image of them.
 */
export async function eraseSpielerAction(rawPayload: FLEraseSpielerPayload): Promise<ActionResult<{ erasure?: FLSpielerErasureResponse }>> {
  return runAdminMutation("eraseSpielerAction", { readOnly: false }, async () => {
    const validated = FLEraseSpielerPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return { success: false, error: VALIDATION_FAILED, fieldErrors: toFieldErrors(validated.error) };
    }

    let erasure;
    try {
      erasure = await eraseSpieler(validated.data);
    } catch (error) {
      const refusal = mapErasureRefusal(error);
      if (refusal !== null) return { success: false, error: refusal };
      throw error;
    }

    // The base `spieler` tag alone: this removed the person and their squad rows, which is what the
    // cached public squad read joins. A club's read joins no pupil, a Spiel embeds none, and the log
    // is admin-tier and uncached.
    invalidateSpieler();

    return {
      success: true,
      erasure,
      message: describeErasureUmfang(erasure.erased_saison_spieler, erasure.redacted_aktionen),
    };
  });
}

export async function postSaisonSpielerAction(
  // Draft-shaped for the same reason as the create: an untouched team picker submits null.
  rawPayload: SaisonSpielerEnterDraft,
): Promise<ActionResult<{ saison_spieler?: FLSaisonSpielerResponse }>> {
  return runAdminMutation("postSaisonSpielerAction", { readOnly: false }, async () => {
    const validated = FLPostSaisonSpielerPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return { success: false, error: VALIDATION_FAILED, fieldErrors: toFieldErrors(validated.error) };
    }

    let saisonSpieler;
    try {
      saisonSpieler = await postSaisonSpieler(validated.data);
    } catch (error) {
      // The named refusals are checked first, because the fallback has no code to inspect: a repeat
      // row from the unique index — which spans RETIRED ones — is what is left once they are ruled out.
      const refusal = mapSquadRefusal(error);
      if (refusal) return { success: false, error: refusal.error ?? VALIDATION_FAILED, fieldErrors: refusal.fieldErrors };
      const entered = mapAlreadyInSaisonRefusal(error);
      if (entered !== null) return { success: false, error: entered };
      throw error;
    }

    invalidateSpieler();

    return {
      success: true,
      saison_spieler: saisonSpieler,
      // The body under `Spieler aufgenommen`, never a second telling of that title: the panel's
      // heading and its button already name the season (`docs/frontend/spec.md` §1.12).
      message: "Nummer, Rolle, Position und Stufe sind noch offen.",
    };
  });
}

export async function patchSaisonSpielerAction(
  rawPayload: SaisonSpielerMembershipDraft,
): Promise<ActionResult<{ saison_spieler?: FLSaisonSpielerResponse }>> {
  return runAdminMutation("patchSaisonSpielerAction", { readOnly: false }, async () => {
    const validated = FLPatchSaisonSpielerPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return { success: false, error: VALIDATION_FAILED, fieldErrors: toFieldErrors(validated.error) };
    }

    let saisonSpieler;
    try {
      saisonSpieler = await patchSaisonSpieler(validated.data);
    } catch (error) {
      const refusal = mapSquadRefusal(error);
      if (refusal) return { success: false, error: refusal.error ?? VALIDATION_FAILED, fieldErrors: refusal.fieldErrors };
      throw error;
    }

    invalidateSpieler();

    return {
      success: true,
      saison_spieler: saisonSpieler,
      message: "Kadereintrag gespeichert",
    };
  });
}

// Independent of the person's own retirement: this takes the player out of ONE season's squad.
export async function deleteSaisonSpielerAction(
  rawPayload: FLSaisonSpielerKeyPayload,
): Promise<ActionResult<{ saison_spieler?: FLSaisonSpielerResponse }>> {
  return runAdminMutation("deleteSaisonSpielerAction", { readOnly: false }, async () => {
    const validated = FLSaisonSpielerKeyPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return { success: false, error: VALIDATION_FAILED, fieldErrors: toFieldErrors(validated.error) };
    }

    const deleteOperation = await deleteSaisonSpieler(validated.data);

    invalidateSpieler();

    return {
      success: true,
      saison_spieler: deleteOperation,
      // The role is on the list although another live row can take it meanwhile: this stamp empties no
      // field, the reactivate brings all four back, and `REQ-SQUAD-004` is what refuses a role given away.
      message: "Nummer, Rolle, Position und Stufe bleiben erhalten.",
    };
  });
}

export async function reactivateSaisonSpielerAction(
  rawPayload: FLSaisonSpielerKeyPayload,
): Promise<ActionResult<{ saison_spieler?: FLSaisonSpielerResponse }>> {
  return runAdminMutation("reactivateSaisonSpielerAction", { readOnly: false }, async () => {
    const validated = FLSaisonSpielerKeyPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return { success: false, error: VALIDATION_FAILED, fieldErrors: toFieldErrors(validated.error) };
    }

    // Reviving a row takes a squad slot like any other write, so the cap refuses it too
    // (`REQ-SQUAD-003`) — and the shared 409 fallback would name no reason.
    let reactivateOperation;
    try {
      reactivateOperation = await reactivateSaisonSpieler(validated.data);
    } catch (error) {
      const refusal = mapSquadRefusal(error);
      if (refusal) return { success: false, error: refusal.error ?? VALIDATION_FAILED, fieldErrors: refusal.fieldErrors };
      throw error;
    }

    invalidateSpieler();

    return {
      success: true,
      saison_spieler: reactivateOperation,
      message: "Nummer, Rolle, Position und Stufe sind wiederhergestellt.",
    };
  });
}
