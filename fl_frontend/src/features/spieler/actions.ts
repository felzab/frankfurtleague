"use server";

import z from "zod";

import { invalidatesOnWrite, refusalResult, runAdminMutation } from "@/shared/utils/adminMutation";
import { partlyRestored, refusedReplay, restored, runAdminUndo, unclearReplay, UNDO_UNREADABLE } from "@/shared/utils/adminUndo";
import { buildRefusal, VERSUCHE_ES_ERNEUT } from "@/shared/utils/refusal";
import { toFieldErrors, VALIDATION_FAILED } from "@/shared/utils/validation";

import { RETIREMENT_KEEPS_SQUAD_ROWS } from "./constants";
import {
  beantrageSpielerAdresswechsel,
  deleteSaisonSpieler,
  deleteSpieler,
  einladeSpielerAdresswechsel,
  eraseSpieler,
  patchSaisonSpieler,
  patchSpieler,
  postSaisonSpieler,
  reactivateSaisonSpieler,
  reactivateSpieler,
  verwirfSpielerAdresswechsel,
} from "./mutations";
import { describeSpielerAdresswechselMail, mailSpielerAdresswechsel } from "./notifications";
import {
  mapAdresswechselAntragRefusal,
  mapAdresswechselLinkRefusal,
  mapAlreadyInSaisonRefusal,
  mapErasureRefusal,
  mapSquadRefusal,
  SQUAD_REPLAY_REFUSALS,
} from "./refusals";
import {
  FLDeleteSpielerPayloadSchema,
  FLEraseSpielerPayloadSchema,
  FLPatchSaisonSpielerPayloadSchema,
  FLPatchSpielerPayloadSchema,
  FLPostSaisonSpielerPayloadSchema,
  FLReactivateSpielerPayloadSchema,
  FLSaisonSpielerKeyPayloadSchema,
  FLSpielerAdresswechselEinladenPayloadSchema,
  FLSpielerAdresswechselPayloadSchema,
  FLSpielerAdresswechselVerwerfenPayloadSchema,
} from "./schemas";
import { describeErasureUmfang } from "./utils";

import type { ActionResult } from "@/shared/types/types";
import type { UndoOutcome } from "@/shared/utils/adminUndo";
import type {
  FLDeleteSpielerPayload,
  FLEraseSpielerPayload,
  FLPatchSpielerPayload,
  FLReactivateSpielerPayload,
  FLSaisonSpielerKeyPayload,
  FLSaisonSpielerResponse,
  FLSpielerAdminSingleResponse,
  FLSpielerAdresswechselEinladenPayload,
  FLSpielerAdresswechselPayload,
  FLSpielerAdresswechselVerwerfenPayload,
  FLSpielerErasureResponse,
} from "./schemas";
import type { SaisonSpielerEnterDraft, SaisonSpielerMembershipDraft } from "./types";

/** Base tag only, for the reason `fl_frontend/src/features/spieler/queries.ts :: getSpieler` gives. */
function invalidateSpieler(): void {
  invalidatesOnWrite("spieler");
}

export async function patchSpielerAction(rawPayload: FLPatchSpielerPayload): Promise<ActionResult<{ spieler?: FLSpielerAdminSingleResponse }>> {
  return runAdminMutation("patchSpielerAction", async () => {
    const validated = FLPatchSpielerPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return { success: false, error: VALIDATION_FAILED, fieldErrors: toFieldErrors(validated.error) };
    }

    invalidateSpieler();
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

    invalidateSpieler();
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

    invalidateSpieler();
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

/**
 * Erases the person: their record, every squad row they hold and their values in the log, in one
 * transaction. **No undo is offered and none exists** — nothing writes the person back, and the log
 * deliberately keeps no image of them.
 */
export async function eraseSpielerAction(rawPayload: FLEraseSpielerPayload): Promise<ActionResult<{ erasure?: FLSpielerErasureResponse }>> {
  return runAdminMutation("eraseSpielerAction", { stepUp: true }, async () => {
    const validated = FLEraseSpielerPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return { success: false, error: VALIDATION_FAILED, fieldErrors: toFieldErrors(validated.error) };
    }

    // The base `spieler` tag alone: this removed the person and their squad rows, which is what the
    // cached public squad read joins. A club's read joins no pupil, a Spiel embeds none, and the log
    // is admin-tier and uncached.
    invalidateSpieler();
    let erasure;
    try {
      erasure = await eraseSpieler(validated.data);
    } catch (error) {
      const refusal = mapErasureRefusal(error);
      if (refusal !== null) return { success: false, error: refusal };
      throw error;
    }

    return {
      success: true,
      erasure,
      message: describeErasureUmfang(erasure.erased_saison_spieler, erasure.redacted_aktionen),
    };
  });
}

/**
 * Asks a pupil's new address to confirm itself: the link goes to the new mailbox and a notice to the
 * stored one, which stays in force until the link is answered.
 */
export async function beantrageSpielerAdresswechselAction(
  rawPayload: FLSpielerAdresswechselPayload,
): Promise<ActionResult<{ versandFehlgeschlagen?: boolean }>> {
  return runAdminMutation("beantrageSpielerAdresswechselAction", { stepUp: true }, async () => {
    const validated = FLSpielerAdresswechselPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return { success: false, error: VALIDATION_FAILED, fieldErrors: toFieldErrors(validated.error) };
    }

    // No tag moves: no cached read holds a pupil's address, the pending one least of all.
    let mintOperation;
    try {
      mintOperation = await beantrageSpielerAdresswechsel(validated.data);
    } catch (error) {
      const refusal = mapAdresswechselAntragRefusal(error);
      if (refusal !== null) return refusalResult(refusal);
      throw error;
    }

    if (!mintOperation.acknowledged) {
      return { success: false, error: buildRefusal({ reason: "Der Link wurde nicht gesendet", repair: VERSUCHE_ES_ERNEUT }) };
    }

    const wechsel = mintOperation.adresswechsel;
    const versand = await mailSpielerAdresswechsel({
      operation: "beantrageSpielerAdresswechselAction",
      spielerId: validated.data.id,
      mint: wechsel,
      anlass: "empfang",
    });

    return {
      success: true,
      // The address the mint names, never the one typed: a rival request landing between the two
      // replaced the mailbox the credential was made for.
      message: describeSpielerAdresswechselMail(wechsel.email, versand),
      versandFehlgeschlagen: versand.link === "fehlgeschlagen",
    };
  });
}

/** A fresh link to the pending address, mailed with a fresh notice to the stored one: the earlier link is dead either way. */
export async function einladeSpielerAdresswechselAction(
  rawPayload: FLSpielerAdresswechselEinladenPayload,
): Promise<ActionResult<{ versandFehlgeschlagen?: boolean }>> {
  return runAdminMutation("einladeSpielerAdresswechselAction", { stepUp: true }, async () => {
    const validated = FLSpielerAdresswechselEinladenPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return { success: false, error: VALIDATION_FAILED, fieldErrors: toFieldErrors(validated.error) };
    }

    let mintOperation;
    try {
      mintOperation = await einladeSpielerAdresswechsel(validated.data);
    } catch (error) {
      const refusal = mapAdresswechselLinkRefusal(error);
      if (refusal !== null) return { success: false, error: refusal };
      throw error;
    }

    if (!mintOperation.acknowledged) {
      return { success: false, error: buildRefusal({ reason: "Der Link wurde nicht gesendet", repair: VERSUCHE_ES_ERNEUT }) };
    }

    const wechsel = mintOperation.adresswechsel;
    const versand = await mailSpielerAdresswechsel({
      operation: "einladeSpielerAdresswechselAction",
      spielerId: validated.data.id,
      mint: wechsel,
      anlass: "erneut",
    });

    return {
      success: true,
      // Said whichever way the send went: the previous link is dead either way, which is the fact an
      // administrator has to act on when the message did not leave.
      message: `${describeSpielerAdresswechselMail(wechsel.email, versand)} Der vorherige Link gilt nicht mehr.`,
      versandFehlgeschlagen: versand.link === "fehlgeschlagen",
    };
  });
}

/** Discards the pending address and its link; the stored address stays, and nobody is mailed. */
export async function verwirfSpielerAdresswechselAction(rawPayload: FLSpielerAdresswechselVerwerfenPayload): Promise<ActionResult> {
  return runAdminMutation("verwirfSpielerAdresswechselAction", { stepUp: true }, async () => {
    const validated = FLSpielerAdresswechselVerwerfenPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return { success: false, error: VALIDATION_FAILED, fieldErrors: toFieldErrors(validated.error) };
    }

    let operation;
    try {
      operation = await verwirfSpielerAdresswechsel(validated.data);
    } catch (error) {
      const refusal = mapAdresswechselLinkRefusal(error);
      if (refusal !== null) return { success: false, error: refusal };
      throw error;
    }

    if (!operation.acknowledged) {
      return { success: false, error: buildRefusal({ reason: "Die Änderung wurde nicht verworfen", repair: VERSUCHE_ES_ERNEUT }) };
    }

    return { success: true, message: "Der Link an die neue Adresse gilt nicht mehr. Die bisherige Adresse bleibt." };
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

    invalidateSpieler();
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
      // heading and its button already name the season (`docs/frontend/spec.md` §1.12).
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

    invalidateSpieler();
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

    invalidateSpieler();
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

    invalidateSpieler();
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

    invalidateSpieler();
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
