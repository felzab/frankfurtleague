"use server";

import { runAdminMutation } from "@/shared/utils/adminMutation";
import { toFieldErrors, VALIDATION_FAILED } from "@/shared/utils/validation";

import { deleteSaisonSpieler, patchSaisonSpieler, patchSpieler, reactivateSaisonSpieler } from "./mutations";
import { mapSquadRefusal } from "./refusals";
import { FLPatchSaisonSpielerPayloadSchema, FLPatchSpielerPayloadSchema, FLSaisonSpielerKeyPayloadSchema } from "./schemas";

import type { FLSaisonSpielerResponse, FLSpielerAdminSingleResponse } from "@/core/generated/client/types";
import type { ActionResult } from "@/shared/types/types";
import type { FLPatchSaisonSpielerPayload, FLSaisonSpielerKeyPayload } from "./schemas";
import type { SpielerPersonPayloadDraft } from "./types";

export async function patchSpielerAction(
  rawPayload: SpielerPersonPayloadDraft,
): Promise<ActionResult<{ spieler?: FLSpielerAdminSingleResponse }>> {
  return runAdminMutation("patchSpielerAction", async () => {
    const validated = FLPatchSpielerPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return { success: false, error: VALIDATION_FAILED, fieldErrors: toFieldErrors(validated.error) };
    }

    const patchOperation = await patchSpieler(validated.data);
    return {
      success: true,
      spieler: patchOperation,
      message: "Spieler bearbeitet",
    };
  });
}

export async function patchSaisonSpielerAction(
  rawPayload: FLPatchSaisonSpielerPayload,
): Promise<ActionResult<{ saison_spieler?: FLSaisonSpielerResponse }>> {
  return runAdminMutation("patchSaisonSpielerAction", async () => {
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

    return {
      success: true,
      saison_spieler: saisonSpieler,
      message: "Kadereintrag gespeichert",
    };
  });
}

export async function deleteSaisonSpielerAction(
  rawPayload: FLSaisonSpielerKeyPayload,
): Promise<ActionResult<{ saison_spieler?: FLSaisonSpielerResponse }>> {
  return runAdminMutation("deleteSaisonSpielerAction", async () => {
    const validated = FLSaisonSpielerKeyPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return { success: false, error: VALIDATION_FAILED, fieldErrors: toFieldErrors(validated.error) };
    }

    const deleteOperation = await deleteSaisonSpieler(validated.data);

    return {
      success: true,
      saison_spieler: deleteOperation,
      // The role is on the list although another live row can take it meanwhile: this stamp empties no
      // field, the reactivate brings all four back, and `kader_rolle_taken` is what refuses a role given away.
      message: "Nummer, Rolle, Position und Stufe bleiben erhalten.",
    };
  });
}

export async function reactivateSaisonSpielerAction(
  rawPayload: FLSaisonSpielerKeyPayload,
): Promise<ActionResult<{ saison_spieler?: FLSaisonSpielerResponse }>> {
  return runAdminMutation("reactivateSaisonSpielerAction", async () => {
    const validated = FLSaisonSpielerKeyPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return { success: false, error: VALIDATION_FAILED, fieldErrors: toFieldErrors(validated.error) };
    }

    // Reviving a row takes a squad slot like any other write, so the cap refuses it too
    // (`kader_full`) — and the shared fallback would name no reason.
    let reactivateOperation;
    try {
      reactivateOperation = await reactivateSaisonSpieler(validated.data);
    } catch (error) {
      const refusal = mapSquadRefusal(error);
      if (refusal) return { success: false, error: refusal.error ?? VALIDATION_FAILED, fieldErrors: refusal.fieldErrors };
      throw error;
    }

    return {
      success: true,
      saison_spieler: reactivateOperation,
      message: "Nummer, Rolle, Position und Stufe sind wiederhergestellt.",
    };
  });
}
