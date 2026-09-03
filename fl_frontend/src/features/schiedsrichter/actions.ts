"use server";

import { updateTag } from "next/cache";

import { getAdminSession } from "@/core/auth";
import { APIBadStatusError } from "@/core/errors";
import { ADMIN_FORBIDDEN, runAdminMutation, VALIDATION_FAILED } from "@/shared/utils/adminMutation";
import { buildRefusal } from "@/shared/utils/refusal";
import { toFieldErrors } from "@/shared/utils/validation";

import { anonymiseSchiedsrichter, deleteSchiedsrichter, patchSchiedsrichter, postSchiedsrichter, reactivateSchiedsrichter } from "./mutations";
import {
  FLAnonymiseSchiedsrichterPayloadSchema,
  FLPatchSchiedsrichterPayloadSchema,
  FLPostSchiedsrichterPayloadSchema,
  FLSchiedsrichterKeyPayloadSchema,
} from "./schemas";

import type { FLSchiedsrichterPayloadDraft } from "@/features/schiedsrichter/schemas";
import type { ActionResult } from "@/shared/types/types";
import type { FieldErrors } from "@/shared/utils/validation";
import type {
  FLAnonymiseSchiedsrichterPayload,
  FLPatchSchiedsrichterPayload,
  FLPostSchiedsrichterPayload,
  FLSchiedsrichter,
  FLSchiedsrichterKeyPayload,
} from "./schemas";

/** `null` where the 409 is something else; it lands on no field, the retire control being a dialog. */
function mapRetireRefusal(error: unknown): { error?: string; fieldErrors?: FieldErrors } | null {
  if (!(error instanceof APIBadStatusError) || error.statusCode !== 409) return null;

  if (error.serverErrorCode === "REQ-RETIRE-004") {
    return {
      error: buildRefusal({
        reason: "Diese Person ist noch für Spiele eingeteilt, die kein Ergebnis haben",
        repair: "Teile die Spiele jemand anderem zu oder sage sie ab",
      }),
    };
  }
  return null;
}

/**
 * The anonymisation refusal, or `null` when the 409 is something else. It lands on no field: the
 * control is a dialog rather than a form.
 */
function mapAnonymiseRefusal(error: unknown): { error?: string; fieldErrors?: FieldErrors } | null {
  if (!(error instanceof APIBadStatusError) || error.statusCode !== 409) return null;

  if (error.serverErrorCode === "REQ-ANONYMISE-001") {
    return {
      error: buildRefusal({
        reason: "Die Kontaktdaten waren schon gelöscht und wurden inzwischen neu eingetragen",
        repair: "Lösche sie erneut, damit auch der neue Stand verschwindet",
      }),
    };
  }
  return null;
}

export async function postSchiedsrichterAction(
  // The DRAFT shape: an emptied money field submits `null`, which the schema below makes a field error.
  rawPayload: FLSchiedsrichterPayloadDraft<FLPostSchiedsrichterPayload>,
): Promise<ActionResult<{ created_id?: string }>> {
  return runAdminMutation("postSchiedsrichterAction", async () => {
    if (!(await getAdminSession())) {
      return { success: false, error: ADMIN_FORBIDDEN };
    }

    const validated = FLPostSchiedsrichterPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return {
        success: false,
        error: VALIDATION_FAILED,
        fieldErrors: toFieldErrors(validated.error),
      };
    }

    const postOperation = await postSchiedsrichter(validated.data);
    if (!postOperation.acknowledged) {
      return { success: false, error: buildRefusal({ reason: "Der Schiedsrichter wurde nicht angelegt", repair: "Versuche es erneut" }) };
    }

    return {
      success: true,
      created_id: postOperation.created_id,
      message: "Schiedsrichter angelegt",
    };
  });
}

export async function patchSchiedsrichterAction(
  // The DRAFT shape: an emptied money field submits `null`, which the schema below makes a field error.
  rawPayload: FLSchiedsrichterPayloadDraft<FLPatchSchiedsrichterPayload>,
): Promise<ActionResult<{ updated_document?: FLSchiedsrichter }>> {
  return runAdminMutation("patchSchiedsrichterAction", async () => {
    if (!(await getAdminSession())) {
      return { success: false, error: ADMIN_FORBIDDEN };
    }

    const validated = FLPatchSchiedsrichterPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return {
        success: false,
        error: VALIDATION_FAILED,
        fieldErrors: toFieldErrors(validated.error),
      };
    }

    const postOperation = await patchSchiedsrichter(validated.data);
    if (!postOperation.acknowledged) {
      return {
        success: false,
        error: buildRefusal({ reason: "Die Schiedsrichterdaten wurden nicht gespeichert", repair: "Versuche es erneut" }),
      };
    }

    // A rename fans the name into every match, the one cached read it reaches; a match keeps its own fee.
    updateTag("spiele");

    return {
      success: true,
      updated_document: postOperation.updated_document,
      message: "Schiedsrichter bearbeitet",
    };
  });
}

export async function deleteSchiedsrichterAction(
  rawPayload: FLSchiedsrichterKeyPayload,
): Promise<ActionResult<{ updated_document?: FLSchiedsrichter }>> {
  return runAdminMutation("deleteSchiedsrichterAction", async () => {
    if (!(await getAdminSession())) {
      return { success: false, error: ADMIN_FORBIDDEN };
    }

    const validated = FLSchiedsrichterKeyPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return {
        success: false,
        error: VALIDATION_FAILED,
        fieldErrors: toFieldErrors(validated.error),
      };
    }

    // The refusal belongs in the dialog that asked, not on the error page.
    let postOperation;
    try {
      postOperation = await deleteSchiedsrichter(validated.data);
    } catch (error) {
      const refusal = mapRetireRefusal(error);
      if (refusal) return { success: false, ...refusal };
      throw error;
    }

    if (!postOperation.acknowledged) {
      return { success: false, error: buildRefusal({ reason: "Der Schiedsrichter wurde nicht stillgelegt", repair: "Versuche es erneut" }) };
    }

    return {
      success: true,
      updated_document: postOperation.updated_document,
      message: "Schiedsrichter stillgelegt. Seine Spiele bleiben erhalten.",
    };
  });
}

/**
 * Nothing to invalidate, unlike the patch: this write moves only `inactive_since`, which no match
 * document carries. The endpoint refuses nothing — a referee coming back carries no fixtures.
 */
export async function reactivateSchiedsrichterAction(
  rawPayload: FLSchiedsrichterKeyPayload,
): Promise<ActionResult<{ updated_document?: FLSchiedsrichter }>> {
  return runAdminMutation("reactivateSchiedsrichterAction", async () => {
    if (!(await getAdminSession())) {
      return { success: false, error: ADMIN_FORBIDDEN };
    }

    const validated = FLSchiedsrichterKeyPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return {
        success: false,
        error: VALIDATION_FAILED,
        fieldErrors: toFieldErrors(validated.error),
      };
    }

    const reactivateOperation = await reactivateSchiedsrichter(validated.data);
    if (!reactivateOperation.acknowledged) {
      return { success: false, error: buildRefusal({ reason: "Der Schiedsrichter wurde nicht reaktiviert", repair: "Versuche es erneut" }) };
    }

    return {
      success: true,
      updated_document: reactivateOperation.updated_document,
      message: "Schiedsrichter reaktiviert",
    };
  });
}

/**
 * Clears the telephone number and email address on the row, and every log row's whole saved
 * pre-image. **Permanent, with no undo.** It refuses `REQ-ANONYMISE-001` alone, and the row survives
 * so every fixture naming the referee resolves.
 */
export async function anonymiseSchiedsrichterAction(
  rawPayload: FLAnonymiseSchiedsrichterPayload,
): Promise<ActionResult<{ updated_document?: FLSchiedsrichter }>> {
  return runAdminMutation("anonymiseSchiedsrichterAction", async () => {
    if (!(await getAdminSession())) {
      return { success: false, error: ADMIN_FORBIDDEN };
    }

    const validated = FLAnonymiseSchiedsrichterPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return {
        success: false,
        error: VALIDATION_FAILED,
        fieldErrors: toFieldErrors(validated.error),
      };
    }

    // The refusal belongs in the dialog that asked, not on the error page.
    let anonymiseOperation;
    try {
      anonymiseOperation = await anonymiseSchiedsrichter(validated.data);
    } catch (error) {
      const refusal = mapAnonymiseRefusal(error);
      if (refusal) return { success: false, ...refusal };
      throw error;
    }

    if (!anonymiseOperation.acknowledged) {
      return { success: false, error: buildRefusal({ reason: "Die Kontaktdaten wurden nicht gelöscht", repair: "Versuche es erneut" }) };
    }

    // Nothing to invalidate, as the reactivate has nothing: this moves `kontakt` alone. The referee
    // list is uncached, a Spiel embeds only the name and the fee, and the log is uncached too, so no
    // cached read holds a contact detail.

    return {
      success: true,
      updated_document: anonymiseOperation.updated_document,
      message:
        "E-Mail und Telefonnummer sind gelöscht. Im Änderungsprotokoll ist der gesicherte Stand jeder Zeile gelöscht, " +
        "die diesen Schiedsrichter betrifft.",
    };
  });
}
