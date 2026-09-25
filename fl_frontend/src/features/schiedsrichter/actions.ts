"use server";

import { updateTag } from "next/cache";

import { refusalResult, runAdminMutation } from "@/shared/utils/adminMutation";
import { buildRefusal } from "@/shared/utils/refusal";
import { toFieldErrors, VALIDATION_FAILED } from "@/shared/utils/validation";

import { SCHIEDSRICHTER_ANONYM_LABEL } from "./constants";
import {
  anonymiseSchiedsrichter,
  deleteSchiedsrichter,
  einladeSchiedsrichter,
  patchSchiedsrichter,
  postSchiedsrichter,
  reactivateSchiedsrichter,
} from "./mutations";
import { describeLinkMail, mailSchiedsrichterLink } from "./notifications";
import { getSchiedsrichterById } from "./queries";
import {
  KEINE_ADRESSE,
  mapAnonymiseRefusal,
  mapEinladenRefusal,
  mapGesperrteAdresseRefusal,
  mapNameRefusal,
  mapReactivateRefusal,
  mapRetireRefusal,
} from "./refusals";
import {
  FLAnonymiseSchiedsrichterPayloadSchema,
  FLPatchSchiedsrichterPayloadSchema,
  FLPostSchiedsrichterPayloadSchema,
  FLSchiedsrichterEinladenPayloadSchema,
  FLSchiedsrichterKeyPayloadSchema,
  hatAdresse,
} from "./schemas";

import type { FLSchiedsrichterPayloadDraft } from "@/features/schiedsrichter/schemas";
import type { ActionResult } from "@/shared/types/types";
import type {
  FLAnonymiseSchiedsrichterPayload,
  FLPatchSchiedsrichterPayload,
  FLPostSchiedsrichterPayload,
  FLSchiedsrichter,
  FLSchiedsrichterEinladenPayload,
  FLSchiedsrichterKeyPayload,
} from "./schemas";

export async function postSchiedsrichterAction(
  // The DRAFT shape: an emptied money field submits `null`, which the schema below makes a field error.
  rawPayload: FLSchiedsrichterPayloadDraft<FLPostSchiedsrichterPayload>,
): Promise<ActionResult<{ created_id: string }>> {
  return runAdminMutation("postSchiedsrichterAction", async () => {
    const validated = FLPostSchiedsrichterPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return {
        success: false,
        error: VALIDATION_FAILED,
        fieldErrors: toFieldErrors(validated.error),
      };
    }

    // The refusal belongs on the box that holds the name or the address, not on the error page.
    let postOperation;
    try {
      postOperation = await postSchiedsrichter(validated.data);
    } catch (error) {
      const refusal = mapNameRefusal(error) ?? mapGesperrteAdresseRefusal(error);
      if (refusal) return refusalResult(refusal);
      throw error;
    }

    if (!postOperation.acknowledged) {
      return { success: false, error: buildRefusal({ reason: "Der Schiedsrichter wurde nicht angelegt", repair: "Versuche es erneut" }) };
    }

    const mint = postOperation.bestaetigung;
    // The address the MINT names, never the one this caller sent: only the mint's own transaction
    // can say which mailbox the credential was made for.
    const versand = await mailSchiedsrichterLink({
      operation: "postSchiedsrichterAction",
      schiedsrichterId: postOperation.created_id,
      email: mint.email,
      name: validated.data.name,
      mint: mint,
      anlass: "empfang",
    });

    return {
      success: true,
      created_id: postOperation.created_id,
      message: describeLinkMail(mint.email, versand),
    };
  });
}

export async function patchSchiedsrichterAction(
  // The DRAFT shape: an emptied money field submits `null`, which the schema below makes a field error.
  rawPayload: FLSchiedsrichterPayloadDraft<FLPatchSchiedsrichterPayload>,
  // A flag beside the message rather than a sentence the caller parses: the editor grades the toast
  // a warning on it, and the save landed either way.
): Promise<ActionResult<{ updated_document?: FLSchiedsrichter; versandSatz?: string; versandFehlgeschlagen?: boolean }>> {
  return runAdminMutation("patchSchiedsrichterAction", async () => {
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
      const refusal = mapNameRefusal(error) ?? mapGesperrteAdresseRefusal(error);
      if (refusal) return refusalResult(refusal);
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

    // Non-null only where the correction moved an unconfirmed referee's address: the old link was
    // posted to a mailbox nobody reads, and leaving it live is a credential in the wrong inbox.
    const mint = postOperation.bestaetigung;
    // The address the MINT names, never the one this caller sent: a save landing between the two
    // would put the credential in the mailbox this one replaced.
    const versand =
      mint === null
        ? null
        : await mailSchiedsrichterLink({
            operation: "patchSchiedsrichterAction",
            schiedsrichterId: validated.data.id,
            email: mint.email,
            name: validated.data.name,
            mint: mint,
            anlass: "erneut",
          });

    return {
      success: true,
      updated_document: postOperation.updated_document,
      message: "Schiedsrichter bearbeitet",
      // Its own field rather than folded into the message: the editor hands this to the undo offer,
      // and a save that mailed nothing has no sentence to hand it.
      versandSatz: mint === null || versand === null ? undefined : describeLinkMail(mint.email, versand),
      versandFehlgeschlagen: versand === false,
    };
  });
}

/**
 * The address is read BEFORE the mint, which replaces the whole block: a read failing afterwards
 * would leave the referee with no working link and no message.
 */
export async function einladeSchiedsrichterAction(rawPayload: FLSchiedsrichterEinladenPayload): Promise<ActionResult<object>> {
  return runAdminMutation("einladeSchiedsrichterAction", async () => {
    const validated = FLSchiedsrichterEinladenPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return {
        success: false,
        error: VALIDATION_FAILED,
        fieldErrors: toFieldErrors(validated.error),
      };
    }

    const gelesen = await getSchiedsrichterById(validated.data.id);
    if (gelesen === null) {
      return { success: false, error: buildRefusal({ reason: "Diesen Eintrag gibt es nicht mehr", repair: "Lade die Seite neu" }) };
    }

    // No address, or the placeholder a row without one is given, rather than making the round trip to
    // be told so. Whether a link may go to a real one is the API's to judge.
    if (!hatAdresse(gelesen.schiedsrichter.kontakt.email)) {
      return { success: false, error: KEINE_ADRESSE };
    }

    // The refusal belongs in the panel that asked, not on the error page.
    let mintOperation;
    try {
      mintOperation = await einladeSchiedsrichter(validated.data);
    } catch (error) {
      const refusal = mapEinladenRefusal(error);
      if (refusal !== null) return { success: false, error: refusal };
      throw error;
    }

    if (!mintOperation.acknowledged) {
      return { success: false, error: buildRefusal({ reason: "Der Bestätigungslink wurde nicht gesendet", repair: "Versuche es erneut" }) };
    }

    // The address the MINT read in its own transaction, never `email` above: this read is the older
    // of the two, and a save landing between them moved the mailbox the credential was made for.
    const mint = mintOperation.bestaetigung;
    const versand = await mailSchiedsrichterLink({
      operation: "einladeSchiedsrichterAction",
      schiedsrichterId: validated.data.id,
      email: mint.email,
      name: gelesen.schiedsrichter.name,
      mint: mint,
      anlass: "erneut",
    });

    return {
      success: true,
      // Said whichever way the send went: the previous link is dead either way, which is the fact an
      // administrator has to act on when the message did not leave.
      message: `${describeLinkMail(mint.email, versand)} Der vorherige Link gilt nicht mehr.`,
    };
  });
}

export async function deleteSchiedsrichterAction(
  rawPayload: FLSchiedsrichterKeyPayload,
): Promise<ActionResult<{ updated_document?: FLSchiedsrichter }>> {
  return runAdminMutation("deleteSchiedsrichterAction", async () => {
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
      if (refusal !== null) return { success: false, error: refusal };
      throw error;
    }

    if (!postOperation.acknowledged) {
      return { success: false, error: buildRefusal({ reason: "Der Schiedsrichter wurde nicht stillgelegt", repair: "Versuche es erneut" }) };
    }

    return {
      success: true,
      updated_document: postOperation.updated_document,
      message: "Die Spiele dieser Person bleiben erhalten.",
    };
  });
}

/**
 * No tag moves, unlike the patch: `inactive_since` reaches no cached read. The spine's refresh is for
 * the admin's own list, which is uncached.
 */
export async function reactivateSchiedsrichterAction(
  rawPayload: FLSchiedsrichterKeyPayload,
  // The save's flag, for the save's reason: the reactivation landed either way, and the row grades
  // its toast a warning where the link it minted did not leave.
): Promise<ActionResult<{ updated_document?: FLSchiedsrichter; versandFehlgeschlagen?: boolean }>> {
  return runAdminMutation("reactivateSchiedsrichterAction", async () => {
    const validated = FLSchiedsrichterKeyPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return {
        success: false,
        error: VALIDATION_FAILED,
        fieldErrors: toFieldErrors(validated.error),
      };
    }

    // The one refusal: the link an unanswered referee is minted on return would go to a banned address.
    let reactivateOperation;
    try {
      reactivateOperation = await reactivateSchiedsrichter(validated.data);
    } catch (error) {
      const refusal = mapReactivateRefusal(error);
      if (refusal !== null) return { success: false, error: refusal };
      throw error;
    }

    if (!reactivateOperation.acknowledged) {
      return { success: false, error: buildRefusal({ reason: "Der Schiedsrichter wurde nicht reaktiviert", repair: "Versuche es erneut" }) };
    }

    // Non-null where the row came back unanswered: a retired referee's save mails nothing, so
    // coming back is what asks them. The address is the one the mint read.
    const mint = reactivateOperation.bestaetigung;
    const versand =
      mint === null
        ? null
        : await mailSchiedsrichterLink({
            operation: "reactivateSchiedsrichterAction",
            schiedsrichterId: validated.data.id,
            email: mint.email,
            name: reactivateOperation.updated_document.name,
            mint: mint,
            anlass: "erneut",
          });

    return {
      success: true,
      updated_document: reactivateOperation.updated_document,
      message: mint === null || versand === null ? "Schiedsrichter reaktiviert" : describeLinkMail(mint.email, versand),
      versandFehlgeschlagen: versand === false,
    };
  });
}

/**
 * Deletes the referee's document and repoints every fixture that named them at the ghost, whose
 * retirement they inherit. **Permanent, with no undo.** It refuses `REQ-ANONYMISE-004` alone — the
 * ghost itself, which stands for nobody.
 */
export async function anonymiseSchiedsrichterAction(
  rawPayload: FLAnonymiseSchiedsrichterPayload,
): Promise<ActionResult<{ updated_document?: FLSchiedsrichter }>> {
  return runAdminMutation("anonymiseSchiedsrichterAction", async () => {
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
      if (refusal !== null) return { success: false, error: refusal };
      throw error;
    }

    if (!anonymiseOperation.acknowledged) {
      return { success: false, error: buildRefusal({ reason: "Die Daten wurden nicht gelöscht", repair: "Versuche es erneut" }) };
    }

    // The repointed booking fans into every match as a rename does, so the same one cached read is
    // stale here. The referee list and the log are uncached.
    updateTag("spiele");

    return {
      success: true,
      updated_document: anonymiseOperation.updated_document,
      message:
        `Der Eintrag ist gelöscht; auf jedem Spiel dieser Person steht jetzt „${SCHIEDSRICHTER_ANONYM_LABEL}“. ` +
        // The one sentence here an administrator must act on: without it a match still to be played
        // sits with nobody to officiate it and nothing says so.
        "Spiele ohne Ergebnis brauchen jetzt einen neuen Schiedsrichter. " +
        "Im Änderungsprotokoll ist der gesicherte Stand jeder Zeile gelöscht, die diese Person betrifft.",
    };
  });
}
