"use server";

import { updateTag } from "next/cache";

import { getAdminSession } from "@/core/auth";
import { APIBadStatusError } from "@/core/errors";
import { ADMIN_FORBIDDEN, runAdminMutation, VALIDATION_FAILED } from "@/shared/utils/adminMutation";
import { toFieldErrors } from "@/shared/utils/validation";

import {
  deleteSaisonSpieler,
  deleteSpieler,
  patchSaisonSpieler,
  patchSpieler,
  postSaisonSpieler,
  postSpieler,
  reactivateSaisonSpieler,
  reactivateSpieler,
} from "./mutations";
import {
  FLCreateSpielerFormPayloadSchema,
  FLDeleteSpielerPayloadSchema,
  FLPatchSaisonSpielerPayloadSchema,
  FLPatchSpielerPayloadSchema,
  FLPostSaisonSpielerPayloadSchema,
  FLReactivateSpielerPayloadSchema,
  FLSaisonSpielerKeyPayloadSchema,
} from "./schemas";

import type { FieldErrors } from "@/shared/utils/validation";
import type {
  FLDeleteSpielerPayload,
  FLPatchSpielerPayload,
  FLReactivateSpielerPayload,
  FLSaisonSpielerKeyPayload,
  FLSaisonSpielerResponse,
  FLSpielerSingleResponse,
} from "./schemas";
import type { SaisonSpielerEnterDraft, SaisonSpielerMembershipDraft, SpielerCreateDraft } from "./types";

// The index spans retired rows and creating never revives, so the message names the one path that does.
const ALREADY_IN_SAISON =
  "Dieser Spieler hat in dieser Saison bereits einen Kadereintrag, möglicherweise einen ausgetragenen. " +
  "Reaktiviere den Eintrag, statt einen neuen anzulegen.";

/** Base tag only: the cached spieler read spans every season. */
function invalidateSpieler(): void {
  updateTag("spieler");
}

/**
 * A squad refusal (`REQ-SQUAD-001`, `REQ-SQUAD-003`), or `null` when the 409 is something else.
 *
 * The membership refusal lands on the field that caused it — the team picker. The cap belongs to no
 * field: it is a fact about the season's rules, and the reactivate path renders no form at all.
 */
function mapSquadRefusal(error: unknown): { error?: string; fieldErrors?: FieldErrors } | null {
  if (!(error instanceof APIBadStatusError) || error.statusCode !== 409) return null;

  if (error.serverErrorCode === "REQ-SQUAD-001") {
    return { fieldErrors: { team_id: "Dieses Team ist in der gewählten Saison nicht dabei." } };
  }
  if (error.serverErrorCode === "REQ-SQUAD-003") {
    return {
      error:
        "Der Kader dieses Teams ist für diese Saison voll. Erhöhe die maximale Kadergröße in den Saisonregeln " +
        "oder trage zuerst einen anderen Spieler aus.",
    };
  }
  return null;
}

export async function postSpielerAction(
  // The DRAFT shape: an untouched picker submits `team_id: null`, and the schema below is what turns
  // that into a field error rather than a type error.
  rawPayload: SpielerCreateDraft,
): Promise<{ success: boolean; spieler_id?: string; message?: string; error?: string; fieldErrors?: FieldErrors }> {
  return runAdminMutation("postSpielerAction", async () => {
    if (!(await getAdminSession())) {
      return { success: false, error: ADMIN_FORBIDDEN };
    }

    const validated = FLCreateSpielerFormPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return { success: false, error: VALIDATION_FAILED, fieldErrors: toFieldErrors(validated.error) };
    }

    const { saison_id, team_id, nummer, position, stufe, is_nachgetragen, is_captain, ...personFields } = validated.data;

    // No 409 branch on the person: no uniqueness rule on a name, because two people can share one.
    const postOperation = await postSpieler(personFields);
    if (!postOperation.acknowledged) {
      return { success: false, error: "Beim Anlegen des neuen Spielers ist ein unerwarteter Fehler aufgetreten" };
    }

    // The junction row, in the same action: without one the player is invisible to every
    // season-scoped read (backend spec I33). A failure here leaves the player EXISTING.
    try {
      await postSaisonSpieler({
        spieler_id: postOperation.spieler_id,
        saison_id,
        team_id,
        nummer,
        position,
        stufe,
        is_nachgetragen,
        is_captain,
      });
    } catch (error) {
      invalidateSpieler();
      // A 409 here cannot be the player's own duplicate row, but it CAN be a squad refusal naming
      // something the admin can act on, so the reason is appended.
      const refusal = mapSquadRefusal(error);
      const because = refusal ? ` ${refusal.error ?? Object.values(refusal.fieldErrors ?? {})[0] ?? ""}` : "";

      return {
        success: false,
        error:
          `Der Spieler wurde angelegt, konnte aber nicht in den Kader aufgenommen werden.${because} ` +
          "Er ist dadurch auf keiner Seite sichtbar. Nimm ihn über die Spielerseite in eine Saison auf.",
      };
    }

    invalidateSpieler();

    return {
      success: Boolean(postOperation.acknowledged),
      spieler_id: postOperation.spieler_id,
      message: "Spieler erfolgreich angelegt!",
    };
  });
}

export async function patchSpielerAction(rawPayload: FLPatchSpielerPayload): Promise<{
  success: boolean;
  spieler?: FLSpielerSingleResponse;
  message?: string;
  error?: string;
  fieldErrors?: FieldErrors;
}> {
  return runAdminMutation("patchSpielerAction", async () => {
    if (!(await getAdminSession())) {
      return { success: false, error: ADMIN_FORBIDDEN };
    }

    const validated = FLPatchSpielerPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return { success: false, error: VALIDATION_FAILED, fieldErrors: toFieldErrors(validated.error) };
    }

    const patchOperation = await patchSpieler(validated.data);
    if (!patchOperation.acknowledged) {
      return { success: false, error: "Beim Bearbeiten der Spielerdaten ist ein unerwarteter Fehler aufgetreten" };
    }

    invalidateSpieler();

    return {
      success: Boolean(patchOperation.acknowledged),
      spieler: patchOperation,
      message: "Spieler erfolgreich bearbeitet!",
    };
  });
}

export async function deleteSpielerAction(
  rawPayload: FLDeleteSpielerPayload,
): Promise<{ success: boolean; spieler?: FLSpielerSingleResponse; message?: string; error?: string; fieldErrors?: FieldErrors }> {
  return runAdminMutation("deleteSpielerAction", async () => {
    if (!(await getAdminSession())) {
      return { success: false, error: ADMIN_FORBIDDEN };
    }

    const validated = FLDeleteSpielerPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return { success: false, error: VALIDATION_FAILED, fieldErrors: toFieldErrors(validated.error) };
    }

    const deleteOperation = await deleteSpieler(validated.data);
    if (!deleteOperation.acknowledged) {
      return { success: false, error: "Beim Stilllegen des Spielers ist ein unerwarteter Fehler aufgetreten" };
    }

    invalidateSpieler();

    return {
      success: Boolean(deleteOperation.acknowledged),
      spieler: deleteOperation,
      message: "Spieler stillgelegt. Seine Kadereinträge bleiben erhalten.",
    };
  });
}

export async function reactivateSpielerAction(
  rawPayload: FLReactivateSpielerPayload,
): Promise<{ success: boolean; spieler?: FLSpielerSingleResponse; message?: string; error?: string; fieldErrors?: FieldErrors }> {
  return runAdminMutation("reactivateSpielerAction", async () => {
    if (!(await getAdminSession())) {
      return { success: false, error: ADMIN_FORBIDDEN };
    }

    const validated = FLReactivateSpielerPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return { success: false, error: VALIDATION_FAILED, fieldErrors: toFieldErrors(validated.error) };
    }

    const reactivateOperation = await reactivateSpieler(validated.data);
    if (!reactivateOperation.acknowledged) {
      return { success: false, error: "Beim Reaktivieren des Spielers ist ein unerwarteter Fehler aufgetreten" };
    }

    invalidateSpieler();

    return {
      success: Boolean(reactivateOperation.acknowledged),
      spieler: reactivateOperation,
      message: "Spieler reaktiviert!",
    };
  });
}

export async function postSaisonSpielerAction(
  // Draft-shaped for the same reason as the create: an untouched team picker submits null.
  rawPayload: SaisonSpielerEnterDraft,
): Promise<{ success: boolean; saison_spieler?: FLSaisonSpielerResponse; message?: string; error?: string; fieldErrors?: FieldErrors }> {
  return runAdminMutation("postSaisonSpielerAction", async () => {
    if (!(await getAdminSession())) {
      return { success: false, error: ADMIN_FORBIDDEN };
    }

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
      if (error instanceof APIBadStatusError && error.statusCode === 409) {
        return { success: false, error: ALREADY_IN_SAISON };
      }
      throw error;
    }

    invalidateSpieler();

    return {
      success: true,
      saison_spieler: saisonSpieler,
      message: `Spieler in die Saison ${validated.data.saison_id} aufgenommen!`,
    };
  });
}

export async function patchSaisonSpielerAction(
  rawPayload: SaisonSpielerMembershipDraft,
): Promise<{ success: boolean; saison_spieler?: FLSaisonSpielerResponse; message?: string; error?: string; fieldErrors?: FieldErrors }> {
  return runAdminMutation("patchSaisonSpielerAction", async () => {
    if (!(await getAdminSession())) {
      return { success: false, error: ADMIN_FORBIDDEN };
    }

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
      message: "Kadereintrag gespeichert!",
    };
  });
}

// Independent of the person's own retirement: this takes the player out of ONE season's squad.
export async function deleteSaisonSpielerAction(
  rawPayload: FLSaisonSpielerKeyPayload,
): Promise<{ success: boolean; saison_spieler?: FLSaisonSpielerResponse; message?: string; error?: string; fieldErrors?: FieldErrors }> {
  return runAdminMutation("deleteSaisonSpielerAction", async () => {
    if (!(await getAdminSession())) {
      return { success: false, error: ADMIN_FORBIDDEN };
    }

    const validated = FLSaisonSpielerKeyPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return { success: false, error: VALIDATION_FAILED, fieldErrors: toFieldErrors(validated.error) };
    }

    const deleteOperation = await deleteSaisonSpieler(validated.data);

    invalidateSpieler();

    return {
      success: true,
      saison_spieler: deleteOperation,
      message: "Spieler aus dem Kader ausgetragen. Nummer und Position bleiben erhalten.",
    };
  });
}

export async function reactivateSaisonSpielerAction(
  rawPayload: FLSaisonSpielerKeyPayload,
): Promise<{ success: boolean; saison_spieler?: FLSaisonSpielerResponse; message?: string; error?: string; fieldErrors?: FieldErrors }> {
  return runAdminMutation("reactivateSaisonSpielerAction", async () => {
    if (!(await getAdminSession())) {
      return { success: false, error: ADMIN_FORBIDDEN };
    }

    const validated = FLSaisonSpielerKeyPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return { success: false, error: VALIDATION_FAILED, fieldErrors: toFieldErrors(validated.error) };
    }

    // Reviving a row takes a squad slot like any other write, so the cap refuses it too
    // (`REQ-SQUAD-003`) — and the generic 409 would call that a duplicate entry.
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
      message: "Kadereintrag reaktiviert. Nummer, Position und Stufe sind wiederhergestellt.",
    };
  });
}
