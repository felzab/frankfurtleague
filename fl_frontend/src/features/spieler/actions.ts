"use server";

import z from "zod";

import { runAdminMutation } from "@/shared/utils/adminMutation";
import { partlyRestored, refusedReplay, restored, runAdminUndo, unclearReplay, UNDO_UNREADABLE } from "@/shared/utils/adminUndo";
import { buildRefusal, VERSUCHE_ES_ERNEUT } from "@/shared/utils/refusal";
import { toFieldErrors, VALIDATION_FAILED } from "@/shared/utils/validation";

import { RETIREMENT_KEEPS_SQUAD_ROWS } from "./constants";
import {
  deleteSaisonSpieler,
  deleteSpieler,
  patchSaisonSpieler,
  patchSpieler,
  postSaisonSpieler,
  reactivateSaisonSpieler,
  reactivateSpieler,
} from "./mutations";
import { mapAlreadyInSaisonRefusal, mapSquadRefusal, SQUAD_REPLAY_REFUSALS } from "./refusals";
import {
  FLDeleteSpielerPayloadSchema,
  FLPatchSaisonSpielerPayloadSchema,
  FLPatchSpielerPayloadSchema,
  FLPostSaisonSpielerPayloadSchema,
  FLReactivateSpielerPayloadSchema,
  FLSaisonSpielerKeyPayloadSchema,
} from "./schemas";

import type { ActionResult } from "@/shared/types/types";
import type { UndoOutcome } from "@/shared/utils/adminUndo";
import type {
  FLDeleteSpielerPayload,
  FLReactivateSpielerPayload,
  FLSaisonSpielerKeyPayload,
  FLSaisonSpielerResponse,
  FLSpielerAdminSingleResponse,
} from "./schemas";
import type { SaisonSpielerEnterDraft, SaisonSpielerMembershipDraft, SpielerPersonPayloadDraft } from "./types";

export async function patchSpielerAction(
  rawPayload: SpielerPersonPayloadDraft,
): Promise<ActionResult<{ spieler?: FLSpielerAdminSingleResponse }>> {
  return runAdminMutation("patchSpielerAction", async () => {
    const validated = FLPatchSpielerPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return { success: false, error: VALIDATION_FAILED, fieldErrors: toFieldErrors(validated.error) };
    }

    const patchOperation = await patchSpieler(validated.data);
    if (!patchOperation.acknowledged) {
      return { success: false, error: buildRefusal({ reason: "Die Spielerdaten wurden nicht gespeichert", repair: VERSUCHE_ES_ERNEUT }) };
    }

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
    const validated = FLDeleteSpielerPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return { success: false, error: VALIDATION_FAILED, fieldErrors: toFieldErrors(validated.error) };
    }

    const deleteOperation = await deleteSpieler(validated.data);
    if (!deleteOperation.acknowledged) {
      return { success: false, error: buildRefusal({ reason: "Der Spieler wurde nicht stillgelegt", repair: VERSUCHE_ES_ERNEUT }) };
    }

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
  return runAdminMutation("reactivateSpielerAction", async () => {
    const validated = FLReactivateSpielerPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return { success: false, error: VALIDATION_FAILED, fieldErrors: toFieldErrors(validated.error) };
    }

    const reactivateOperation = await reactivateSpieler(validated.data);
    if (!reactivateOperation.acknowledged) {
      return { success: false, error: buildRefusal({ reason: "Der Spieler wurde nicht reaktiviert", repair: VERSUCHE_ES_ERNEUT }) };
    }

    return {
      success: true,
      spieler: reactivateOperation,
      message: "Spieler reaktiviert",
    };
  });
}

export async function postSaisonSpielerAction(
  // Draft-shaped for the same reason as the create: an untouched team picker submits null.
  rawPayload: SaisonSpielerEnterDraft,
): Promise<ActionResult<{ saison_spieler?: FLSaisonSpielerResponse }>> {
  return runAdminMutation("postSaisonSpielerAction", async () => {
    const validated = FLPostSaisonSpielerPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return { success: false, error: VALIDATION_FAILED, fieldErrors: toFieldErrors(validated.error) };
    }

    let saisonSpieler;
    try {
      saisonSpieler = await postSaisonSpieler(validated.data);
    } catch (error) {
      const refusal = mapSquadRefusal(error);
      if (refusal) return { success: false, error: refusal.error ?? VALIDATION_FAILED, fieldErrors: refusal.fieldErrors };
      const entered = mapAlreadyInSaisonRefusal(error);
      if (entered !== null) return { success: false, error: entered };
      throw error;
    }

    return {
      success: true,
      saison_spieler: saisonSpieler,
      // The body under `Spieler aufgenommen`, never a second telling of that title: the panel's
      // heading and its button already name the season.
      message: "Nummer, Rolle, Position und Stufe sind noch offen.",
    };
  });
}

export async function patchSaisonSpielerAction(
  rawPayload: SaisonSpielerMembershipDraft,
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

// Independent of the person's own retirement: this takes the player out of ONE season's squad.
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
      // field, the reactivate brings all four back, and `REQ-SQUAD-004` is what refuses a role given away.
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
    // (`REQ-SQUAD-003`) — and the shared fallback would name no reason.
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

const SpielerUndoSchema = z
  .object({
    person: FLPatchSpielerPayloadSchema.optional(),
    saison: FLPatchSaisonSpielerPayloadSchema.optional(),
  })
  .refine((body) => body.person !== undefined || body.saison !== undefined, {
    error: "Nothing to restore",
  });

/** What closes a refusal where the person half went back first, which the change standing would deny. */
const PERSON_HALF_RESTORED = "Nur die Personendaten wurden zurückgesetzt.";

/** The squad half after the person half went back, as a refusal names it. */
const SQUAD_HALF = { unworded: "Der Kadereintrag lässt sich so nicht mehr zurücksetzen.", restored: PERSON_HALF_RESTORED };

export async function undoAdminSpielerEditAction(rawPayload: z.input<typeof SpielerUndoSchema>): Promise<UndoOutcome> {
  return runAdminUndo("undoAdminSpielerEditAction", async () => {
    const validated = SpielerUndoSchema.safeParse(rawPayload);
    if (!validated.success) return { success: false, error: UNDO_UNREADABLE };
    const { person, saison } = validated.data;

    if (person !== undefined) {
      // No replay catch: the register declares no refusal against the season-independent person row.
      const operation = await patchSpieler(person);
      if (!operation.acknowledged) return unclearReplay("Die Rücknahme wurde abgebrochen. Prüfe die Spielerdaten.");
    }

    if (saison !== undefined) {
      let operation;
      try {
        operation = await patchSaisonSpieler(saison);
      } catch (error) {
        return person === undefined ? refusedReplay(error, SQUAD_REPLAY_REFUSALS) : partlyRestored(error, SQUAD_REPLAY_REFUSALS, SQUAD_HALF);
      }

      if (!operation.acknowledged) {
        // The first half may already be restored; reported rather than papered over.
        return unclearReplay(
          person === undefined ? "Die Rücknahme wurde abgebrochen. Prüfe den Kadereintrag." : `${PERSON_HALF_RESTORED} Prüfe den Kadereintrag.`,
        );
      }
    }

    return restored();
  });
}
