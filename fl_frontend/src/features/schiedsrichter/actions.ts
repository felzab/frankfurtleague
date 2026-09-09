"use server";

import { updateTag } from "next/cache";

import { getAdminSession } from "@/core/auth";
import { APIBadStatusError } from "@/core/errors";
import { ADMIN_FORBIDDEN, runAdminMutation, VALIDATION_FAILED } from "@/shared/utils/adminMutation";
import { buildRefusal } from "@/shared/utils/refusal";
import { toFieldErrors } from "@/shared/utils/validation";

import { SCHIEDSRICHTER_ANONYM_LABEL } from "./constants";
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

/**
 * `null` where the 409 is something else. It lands on the NAME box: `uniq_schiedsrichter_name` is this
 * collection's only unique index, so the code can be about no other value the create or the edit sent.
 */
function mapNameRefusal(error: unknown): { error?: string; fieldErrors?: FieldErrors } | null {
  if (!(error instanceof APIBadStatusError) || error.statusCode !== 409) return null;

  // No repair sentence: the box carrying the message is itself the way out (`docs/frontend/spec.md` §1.12).
  if (error.serverErrorCode === "DB-COMMON-002") {
    return { fieldErrors: { name: "Diesen Namen gibt es schon." } };
  }
  return null;
}

/** `null` where the 409 is something else; it lands on no field, three boxes each triggering it alone. */
function mapEditRefusal(error: unknown): { error?: string; fieldErrors?: FieldErrors } | null {
  if (!(error instanceof APIBadStatusError) || error.statusCode !== 409) return null;

  if (error.serverErrorCode === "REQ-ANONYMISE-002") {
    return {
      error: buildRefusal({
        reason: "Die Daten dieser Person wurden gelöscht, und jedes Speichern würde einen Namen wieder eintragen",
        // No route back is named here: the deletion panel on this same page already refuses one
        // (`fl_frontend/src/features/schiedsrichter/components/forms/AdminSchiedsrichterEditForm/FormAnonymisierenSection.tsx`).
        repair: "Lade die Seite neu",
      }),
    };
  }
  return null;
}

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

/** `null` where the 409 is something else; it lands on no field, the reactivation being a row control. */
function mapReactivateRefusal(error: unknown): { error?: string; fieldErrors?: FieldErrors } | null {
  if (!(error instanceof APIBadStatusError) || error.statusCode !== 409) return null;

  if (error.serverErrorCode === "REQ-ANONYMISE-003") {
    return {
      error: buildRefusal({
        // The repair names a NEW entry rather than a route back: nothing can undo the deletion, and a
        // sentence hinting at one sends a teacher looking for a button that is not there.
        reason: "Diese Person hat ihre Daten löschen lassen, deshalb bleibt der Eintrag stillgelegt",
        repair: "Wenn sie wieder Spiele leitet, lege sie als neuen Schiedsrichter an",
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
        reason: "Die Daten waren schon gelöscht und Name oder Kontaktdaten wurden inzwischen neu eingetragen",
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

    // The refusal belongs on the box that holds the name, not on the error page.
    let postOperation;
    try {
      postOperation = await postSchiedsrichter(validated.data);
    } catch (error) {
      const refusal = mapNameRefusal(error);
      if (refusal) return { success: false, ...refusal };
      throw error;
    }

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

    // The refusal belongs on the form that asked, not on the error page.
    let postOperation;
    try {
      postOperation = await patchSchiedsrichter(validated.data);
    } catch (error) {
      const refusal = mapEditRefusal(error) ?? mapNameRefusal(error);
      if (refusal) return { success: false, ...refusal };
      throw error;
    }

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
      message: "Schiedsrichter stillgelegt. Die Spiele dieser Person bleiben erhalten.",
    };
  });
}

/**
 * Nothing to invalidate, unlike the patch: this write moves only `inactive_since`, which no match
 * document carries. It refuses `REQ-ANONYMISE-003` alone — an erased referee stays retired.
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

    // The refusal belongs on the control that asked, not on the error page.
    let reactivateOperation;
    try {
      reactivateOperation = await reactivateSchiedsrichter(validated.data);
    } catch (error) {
      const refusal = mapReactivateRefusal(error);
      if (refusal) return { success: false, ...refusal };
      throw error;
    }

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
 * Nulls the name and the school, clears the two contact fields, retires the referee, and empties every
 * log row's saved pre-image. **Permanent, with no undo.** It refuses `REQ-ANONYMISE-001` alone, and the
 * row survives so every fixture booking still resolves.
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
      return { success: false, error: buildRefusal({ reason: "Die Daten wurden nicht gelöscht", repair: "Versuche es erneut" }) };
    }

    // The NULLED name fans into every match as a rename does, so the same one cached read is stale
    // here. The referee list and the log are uncached.
    updateTag("spiele");

    return {
      success: true,
      updated_document: anonymiseOperation.updated_document,
      message:
        `Name, Schule, E-Mail und Telefonnummer sind gelöscht; auf jedem Spiel steht jetzt „${SCHIEDSRICHTER_ANONYM_LABEL}“. ` +
        "Der Eintrag ist stillgelegt und nimmt keine neuen Spiele mehr an. " +
        // The erasure retires without the retirement's own refusal, so a fixture still to be played
        // keeps this person booked on it and shows no name until somebody reassigns it.
        "Spiele ohne Ergebnis behalten die Zuteilung und müssen neu zugeteilt werden. " +
        "Im Änderungsprotokoll ist der gesicherte Stand jeder Zeile gelöscht, die diese Person betrifft.",
    };
  });
}
