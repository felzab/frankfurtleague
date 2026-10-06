"use server";

import { isFreshlySignedIn } from "@/core/auth";
import { invalidatesOnWrite, refusalResult, refuseUnconfirmed, runAdminMutation } from "@/shared/utils/adminMutation";
import { buildRefusal, VERSUCHE_ES_ERNEUT } from "@/shared/utils/refusal";
import { toFieldErrors, VALIDATION_FAILED } from "@/shared/utils/validation";

import { SCHIEDSRICHTER_ANONYM_LABEL } from "./constants";
import { returnMayMint, saveMayMint } from "./linkMint";
import {
  anonymiseSchiedsrichter,
  deleteSchiedsrichter,
  einladeAdresswechsel,
  einladeSchiedsrichter,
  patchSchiedsrichter,
  postSchiedsrichter,
  reactivateSchiedsrichter,
  verwirfAdresswechsel,
} from "./mutations";
import { describeAdresswechselMail, describeLinkMail, mailSchiedsrichterAdresswechsel, mailSchiedsrichterLink } from "./notifications";
import { getSchiedsrichterById } from "./queries";
import {
  KEINE_ADRESSE,
  mapAdresswechselRefusal,
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
  FLSchiedsrichterAdresswechselEinladenPayloadSchema,
  FLSchiedsrichterAdresswechselVerwerfenPayloadSchema,
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
  FLSchiedsrichterAdresswechselEinladenPayload,
  FLSchiedsrichterAdresswechselVerwerfenPayload,
  FLSchiedsrichterEinladenPayload,
  FLSchiedsrichterKeyPayload,
} from "./schemas";

export async function postSchiedsrichterAction(
  // The DRAFT shape: an emptied money field submits `null`, which the schema below makes a field error.
  rawPayload: FLSchiedsrichterPayloadDraft<FLPostSchiedsrichterPayload>,
): Promise<ActionResult<{ created_id: string }>> {
  return runAdminMutation("postSchiedsrichterAction", { stepUp: true }, async () => {
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
      return { success: false, error: buildRefusal({ reason: "Der Schiedsrichter wurde nicht angelegt", repair: VERSUCHE_ES_ERNEUT }) };
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
): Promise<
  ActionResult<{
    updated_document?: FLSchiedsrichter;
    versandSatz?: string;
    versandFehlgeschlagen?: boolean;
    adresswechselGespeichert?: boolean;
  }>
> {
  return runAdminMutation("patchSchiedsrichterAction", async (session) => {
    const validated = FLPatchSchiedsrichterPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return {
        success: false,
        error: VALIDATION_FAILED,
        fieldErrors: toFieldErrors(validated.error),
      };
    }

    // A rename fans the name into every match, the one cached read it reaches; a match keeps its own fee.
    invalidatesOnWrite("spiele");
    // A save minting a new link is a step-up write and any other save is not, so the stored row
    // decides; read only for a session past the window, the one it can refuse.
    const stored = isFreshlySignedIn(session) ? null : await getSchiedsrichterById(validated.data.id);
    const unconfirmed = stored !== null && saveMayMint(stored.schiedsrichter, validated.data.kontakt.email) ? refuseUnconfirmed(session) : null;
    if (unconfirmed !== null) return unconfirmed;

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
        error: buildRefusal({ reason: "Die Schiedsrichterdaten wurden nicht gespeichert", repair: VERSUCHE_ES_ERNEUT }),
      };
    }

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

    // Non-null only where the save moved a confirmed referee's address, which waits on the new mailbox.
    const wechsel = postOperation.adresswechsel;
    const wechselVersand =
      wechsel === null
        ? null
        : await mailSchiedsrichterAdresswechsel({
            operation: "patchSchiedsrichterAction",
            schiedsrichterId: validated.data.id,
            name: validated.data.name,
            mint: wechsel,
            anlass: "empfang",
          });

    return {
      success: true,
      updated_document: postOperation.updated_document,
      message: "Schiedsrichter bearbeitet",
      // Its own field rather than folded into the message: the editor hands this to the undo offer,
      // and a save that mailed nothing has no sentence to hand it.
      versandSatz:
        mint !== null && versand !== null
          ? describeLinkMail(mint.email, versand)
          : wechsel !== null && wechselVersand !== null
            ? describeAdresswechselMail(wechsel.email, wechselVersand)
            : undefined,
      versandFehlgeschlagen: versand === "fehlgeschlagen" || wechselVersand?.link === "fehlgeschlagen",
      // The backend's own word that THIS save left a new address waiting, for the undo to tell apart
      // from a save that moved only the fee while an earlier change waited.
      adresswechselGespeichert: wechsel !== null,
    };
  });
}

/**
 * The address is read BEFORE the mint, which replaces the whole block: a read failing afterwards
 * would leave the referee with no working link and no message.
 */
export async function einladeSchiedsrichterAction(rawPayload: FLSchiedsrichterEinladenPayload): Promise<ActionResult<object>> {
  return runAdminMutation("einladeSchiedsrichterAction", { stepUp: true }, async () => {
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
      return { success: false, error: buildRefusal({ reason: "Der Bestätigungslink wurde nicht gesendet", repair: VERSUCHE_ES_ERNEUT }) };
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

/** A fresh link to the pending address, mailed with a fresh notice to the stored one: the earlier link is dead either way. */
export async function einladeAdresswechselAction(rawPayload: FLSchiedsrichterAdresswechselEinladenPayload): Promise<ActionResult<object>> {
  return runAdminMutation("einladeAdresswechselAction", { stepUp: true }, async () => {
    const validated = FLSchiedsrichterAdresswechselEinladenPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return { success: false, error: VALIDATION_FAILED, fieldErrors: toFieldErrors(validated.error) };
    }

    // The first name the mails greet with. Read before the mint, for the consent re-send's reason.
    const gelesen = await getSchiedsrichterById(validated.data.id);
    if (gelesen === null) {
      return { success: false, error: buildRefusal({ reason: "Diesen Eintrag gibt es nicht mehr", repair: "Lade die Seite neu" }) };
    }

    let mintOperation;
    try {
      mintOperation = await einladeAdresswechsel(validated.data);
    } catch (error) {
      const refusal = mapAdresswechselRefusal(error);
      if (refusal !== null) return { success: false, error: refusal };
      throw error;
    }

    if (!mintOperation.acknowledged) {
      return { success: false, error: buildRefusal({ reason: "Der Link wurde nicht gesendet", repair: VERSUCHE_ES_ERNEUT }) };
    }

    // Both addresses as the mint read them in its own transaction, never as this action's read had them.
    const wechsel = mintOperation.adresswechsel;
    const versand = await mailSchiedsrichterAdresswechsel({
      operation: "einladeAdresswechselAction",
      schiedsrichterId: validated.data.id,
      name: gelesen.schiedsrichter.name,
      mint: wechsel,
      anlass: "erneut",
    });

    return { success: true, message: `${describeAdresswechselMail(wechsel.email, versand)} Der vorherige Link gilt nicht mehr.` };
  });
}

/** Discards the pending address and its link; the stored address stays, and nobody is mailed. */
export async function verwirfAdresswechselAction(
  rawPayload: FLSchiedsrichterAdresswechselVerwerfenPayload,
): Promise<ActionResult<{ updated_document?: FLSchiedsrichter }>> {
  return runAdminMutation("verwirfAdresswechselAction", { stepUp: true }, async () => {
    const validated = FLSchiedsrichterAdresswechselVerwerfenPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return { success: false, error: VALIDATION_FAILED, fieldErrors: toFieldErrors(validated.error) };
    }

    let operation;
    try {
      operation = await verwirfAdresswechsel(validated.data);
    } catch (error) {
      const refusal = mapAdresswechselRefusal(error);
      if (refusal !== null) return { success: false, error: refusal };
      throw error;
    }

    if (!operation.acknowledged) {
      return { success: false, error: buildRefusal({ reason: "Die Änderung wurde nicht verworfen", repair: VERSUCHE_ES_ERNEUT }) };
    }

    return {
      success: true,
      updated_document: operation.updated_document,
      message: "Der Link an die neue Adresse gilt nicht mehr; die bisherige Adresse bleibt.",
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
      return { success: false, error: buildRefusal({ reason: "Der Schiedsrichter wurde nicht stillgelegt", repair: VERSUCHE_ES_ERNEUT }) };
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
  return runAdminMutation("reactivateSchiedsrichterAction", async (session) => {
    const validated = FLSchiedsrichterKeyPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return {
        success: false,
        error: VALIDATION_FAILED,
        fieldErrors: toFieldErrors(validated.error),
      };
    }

    // The save's reason: a return minting a link is a step-up write, any other return is not.
    const stored = isFreshlySignedIn(session) ? null : await getSchiedsrichterById(validated.data.id);
    const unconfirmed = stored !== null && returnMayMint(stored.schiedsrichter) ? refuseUnconfirmed(session) : null;
    if (unconfirmed !== null) return unconfirmed;

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
      return { success: false, error: buildRefusal({ reason: "Der Schiedsrichter wurde nicht reaktiviert", repair: VERSUCHE_ES_ERNEUT }) };
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
      versandFehlgeschlagen: versand === "fehlgeschlagen",
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
  return runAdminMutation("anonymiseSchiedsrichterAction", { stepUp: true }, async () => {
    const validated = FLAnonymiseSchiedsrichterPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return {
        success: false,
        error: VALIDATION_FAILED,
        fieldErrors: toFieldErrors(validated.error),
      };
    }

    // The repointed booking fans into every match as a rename does, so the same one cached read is
    // stale here. The referee list and the log are uncached.
    invalidatesOnWrite("spiele");
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
      return { success: false, error: buildRefusal({ reason: "Die Daten wurden nicht gelöscht", repair: VERSUCHE_ES_ERNEUT }) };
    }

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
