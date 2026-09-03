"use server";

import { updateTag } from "next/cache";

import { getAdminSession } from "@/core/auth";
import { APIBadStatusError } from "@/core/errors";
import { ADMIN_FORBIDDEN, runAdminMutation, VALIDATION_FAILED } from "@/shared/utils/adminMutation";
import { buildRefusal } from "@/shared/utils/refusal";
import { toFieldErrors } from "@/shared/utils/validation";

import { ERASURE_NEEDS_RETIREMENT } from "./constants";
import {
  deleteSaisonSpieler,
  deleteSpieler,
  eraseSpieler,
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
  FLEraseSpielerPayloadSchema,
  FLPatchSaisonSpielerPayloadSchema,
  FLPatchSpielerPayloadSchema,
  FLPostSaisonSpielerPayloadSchema,
  FLReactivateSpielerPayloadSchema,
  FLSaisonSpielerKeyPayloadSchema,
} from "./schemas";
import { describeErasureUmfang } from "./utils";

import type { ActionResult } from "@/shared/types/types";
import type { FieldErrors } from "@/shared/utils/validation";
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
import type { SaisonSpielerEnterDraft, SaisonSpielerMembershipDraft, SpielerCreateDraft } from "./types";

// The index spans retired rows and creating never revives, so the message names the one path that does.
const ALREADY_IN_SAISON = buildRefusal({
  reason: "Dieser Spieler hat in dieser Saison schon einen Kadereintrag, möglicherweise einen ausgetragenen",
  repair: "Reaktiviere den Eintrag, statt einen neuen anzulegen",
});

// Reachable with no picker on screen: a reactivate names the row's STORED club, which a replacement
// can have taken out of the season.
const SQUAD_TEAM_NOT_IN_SAISON =
  "Das Team dieses Kadereintrags ist in dieser Saison nicht dabei. Weise den Eintrag im Bereich „Kader“ auf der Seite " +
  "des Spielers zuerst einem Team dieser Saison zu.";

// Neither role is named: the reactivate offers no role on screen, and one sentence has to serve it
// as well as the two the editor picks between.
const SQUAD_ROLLE_TAKEN = buildRefusal({
  reason: "In diesem Team ist diese Rolle schon vergeben",
  repair: "Nimm sie dem anderen Spieler zuerst ab, dann kannst Du sie hier vergeben",
});

/** Base tag only: the cached spieler read spans every season. */
function invalidateSpieler(): void {
  updateTag("spieler");
}

/**
 * Two shapes for one refusal: the field message marks the team picker, and the sentence beside it is
 * what a reactivate toasts, that path rendering no field at all. Neither the cap nor a taken role
 * belongs to a field — one is a fact about the season's rules, the other about the squad.
 */
function mapSquadRefusal(error: unknown): { error?: string; fieldErrors?: FieldErrors } | null {
  if (!(error instanceof APIBadStatusError) || error.statusCode !== 409) return null;

  if (error.serverErrorCode === "REQ-SQUAD-001") {
    return { error: SQUAD_TEAM_NOT_IN_SAISON, fieldErrors: { team_id: "Dieses Team ist in der gewählten Saison nicht dabei." } };
  }
  if (error.serverErrorCode === "REQ-SQUAD-004") {
    return { error: SQUAD_ROLLE_TAKEN };
  }
  if (error.serverErrorCode === "REQ-SQUAD-003") {
    return {
      error: buildRefusal({
        reason: "Der Kader dieses Teams ist für diese Saison voll",
        repair: "Erhöhe die maximale Kadergröße in den Saisonregeln oder trage zuerst einen anderen Spieler aus",
      }),
    };
  }
  return null;
}

/**
 * The erasure's precondition, or `null` when the 409 is something else. It lands on no field: the
 * control is a panel with nothing to fill in, and the repair it names is on another page.
 */
function mapErasureRefusal(error: unknown): string | null {
  if (!(error instanceof APIBadStatusError) || error.statusCode !== 409) return null;

  if (error.serverErrorCode === "REQ-PURGE-001") return ERASURE_NEEDS_RETIREMENT;
  return null;
}

export async function postSpielerAction(
  // The DRAFT shape: an untouched picker submits `team_id: null`, and the schema below is what turns
  // that into a field error rather than a type error.
  rawPayload: SpielerCreateDraft,
): Promise<ActionResult<{ spieler_id?: string }>> {
  return runAdminMutation("postSpielerAction", async () => {
    if (!(await getAdminSession())) {
      return { success: false, error: ADMIN_FORBIDDEN };
    }

    const validated = FLCreateSpielerFormPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return { success: false, error: VALIDATION_FAILED, fieldErrors: toFieldErrors(validated.error) };
    }

    const { saison_id, team_id, nummer, position, stufe, is_nachgetragen, rolle, ...personFields } = validated.data;

    // No 409 branch on the person: no uniqueness rule on a name, because two people can share one.
    const postOperation = await postSpieler(personFields);
    if (!postOperation.acknowledged) {
      return { success: false, error: buildRefusal({ reason: "Der Spieler wurde nicht angelegt", repair: "Versuche es erneut" }) };
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
        rolle,
      });
    } catch (error) {
      invalidateSpieler();
      // A 409 here cannot be the player's own duplicate row, but it CAN be a squad refusal naming
      // something the admin can act on, so the reason is appended.
      const refusal = mapSquadRefusal(error);
      // The field message first: this path HAS a picker, so the short sentence written for it is also
      // the one that reads best appended here. The cap carries no field message and falls through.
      const because = refusal ? ` ${Object.values(refusal.fieldErrors ?? {})[0] ?? refusal.error ?? ""}` : "";

      return {
        success: false,
        error:
          `Der Spieler wurde angelegt, steht aber in keinem Kader und ist dadurch auf keiner Seite sichtbar.${because} ` +
          "Nimm ihn über die Spielerseite in eine Saison auf.",
      };
    }

    invalidateSpieler();

    return {
      success: true,
      spieler_id: postOperation.spieler_id,
      message: "Spieler angelegt",
    };
  });
}

export async function patchSpielerAction(rawPayload: FLPatchSpielerPayload): Promise<ActionResult<{ spieler?: FLSpielerAdminSingleResponse }>> {
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
      return { success: false, error: buildRefusal({ reason: "Der Spieler wurde nicht stillgelegt", repair: "Versuche es erneut" }) };
    }

    invalidateSpieler();

    return {
      success: true,
      spieler: deleteOperation,
      message: "Spieler stillgelegt. Seine Kadereinträge bleiben erhalten.",
    };
  });
}

export async function reactivateSpielerAction(
  rawPayload: FLReactivateSpielerPayload,
): Promise<ActionResult<{ spieler?: FLSpielerAdminSingleResponse }>> {
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
  return runAdminMutation("eraseSpielerAction", async () => {
    if (!(await getAdminSession())) {
      return { success: false, error: ADMIN_FORBIDDEN };
    }

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
      message: `Spieler in die Saison ${validated.data.saison_id} aufgenommen`,
    };
  });
}

export async function patchSaisonSpielerAction(
  rawPayload: SaisonSpielerMembershipDraft,
): Promise<ActionResult<{ saison_spieler?: FLSaisonSpielerResponse }>> {
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
      message: "Kadereintrag gespeichert",
    };
  });
}

// Independent of the person's own retirement: this takes the player out of ONE season's squad.
export async function deleteSaisonSpielerAction(
  rawPayload: FLSaisonSpielerKeyPayload,
): Promise<ActionResult<{ saison_spieler?: FLSaisonSpielerResponse }>> {
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
): Promise<ActionResult<{ saison_spieler?: FLSaisonSpielerResponse }>> {
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
