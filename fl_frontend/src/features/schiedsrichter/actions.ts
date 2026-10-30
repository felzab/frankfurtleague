"use server";

import { drainSoon } from "@/core/afterResponse";
import { isFreshlySignedIn } from "@/core/auth";
import { refusalResult, refuseUnconfirmed, runAdminMutation } from "@/shared/utils/adminMutation";
import { buildRefusal, LADE_DIE_SEITE_NEU } from "@/shared/utils/refusal";
import { toFieldErrors, VALIDATION_FAILED } from "@/shared/utils/validation";

import { returnMayMint, saveMayMint } from "./linkMint";
import { deleteSchiedsrichter, einladeSchiedsrichter, patchSchiedsrichter, postSchiedsrichter, reactivateSchiedsrichter } from "./mutations";
import { getSchiedsrichterById } from "./queries";
import {
  KEINE_ADRESSE,
  mapBestaetigteAdresseRefusal,
  mapEinladenRefusal,
  mapGesperrteAdresseRefusal,
  mapNameRefusal,
  mapReactivateRefusal,
  mapRetireRefusal,
} from "./refusals";
import {
  FLPatchSchiedsrichterPayloadSchema,
  FLPostSchiedsrichterPayloadSchema,
  FLSchiedsrichterEinladenPayloadSchema,
  FLSchiedsrichterKeyPayloadSchema,
  hatAdresse,
} from "./schemas";

import type { FLSchiedsrichter } from "@/core/generated/client/types";
import type { FLSchiedsrichterPayloadDraft } from "@/features/schiedsrichter/schemas";
import type { ActionResult } from "@/shared/types/types";
import type {
  FLPatchSchiedsrichterPayload,
  FLPostSchiedsrichterPayload,
  FLSchiedsrichterEinladenPayload,
  FLSchiedsrichterKeyPayload,
} from "./schemas";

/**
 * What the administrator is told of the confirmation link a write owed: the address the write's own transaction read,
 * never the one this caller sent, a save landing between the two having moved the mailbox. The Postausgang mails it at
 * once, behind the response; the editor's panel then shows what became of it.
 */
function linkSatz(email: string): string {
  return `Der Bestätigungslink geht an ${email}.`;
}

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

    drainSoon();

    return {
      success: true,
      created_id: postOperation.created_id,
      message: linkSatz(postOperation.bestaetigung.email),
    };
  });
}

export async function patchSchiedsrichterAction(
  // The DRAFT shape: an emptied money field submits `null`, which the schema below makes a field error.
  rawPayload: FLSchiedsrichterPayloadDraft<FLPatchSchiedsrichterPayload>,
): Promise<
  ActionResult<{
    updated_document?: FLSchiedsrichter;
    versandSatz?: string;
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
      const refusal = mapNameRefusal(error) ?? mapGesperrteAdresseRefusal(error) ?? mapBestaetigteAdresseRefusal(error);
      if (refusal) return refusalResult(refusal);
      throw error;
    }

    // Non-null only where the correction moved an unconfirmed referee's address: the old link was
    // posted to a mailbox nobody reads, and leaving it live is a credential in the wrong inbox.
    const mint = postOperation.bestaetigung;
    if (mint !== null) drainSoon();

    return {
      success: true,
      updated_document: postOperation.updated_document,
      message: "Schiedsrichter bearbeitet",
      // Its own field rather than folded into the message: the editor's toast says it in place of the
      // save's sentence, and a save that owed no link has no sentence to hand it.
      versandSatz: mint === null ? undefined : linkSatz(mint.email),
    };
  });
}

/** A row gone before a mint could read its address: both link sends meet it. */
const EINTRAG_WEG = buildRefusal({ reason: "Diesen Eintrag gibt es nicht mehr", repair: LADE_DIE_SEITE_NEU });

/**
 * The address is read BEFORE the mint, which replaces the whole block: a read failing afterwards
 * would leave the referee with no working link and no message.
 */
export async function einladeSchiedsrichterAction(rawPayload: FLSchiedsrichterEinladenPayload): Promise<ActionResult> {
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
      return { success: false, error: EINTRAG_WEG };
    }

    // No address, rather than making the round trip to be told so. Whether a link may go to the one
    // stored is the API's to judge.
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

    drainSoon();

    return {
      success: true,
      // The address the write read in its own transaction, never the one above: this read is the older of the two.
      message: `${linkSatz(mintOperation.bestaetigung.email)} Der vorherige Link gilt nicht mehr.`,
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
): Promise<ActionResult<{ updated_document?: FLSchiedsrichter }>> {
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

    // Non-null where the row came back unanswered: a retired referee's save mails nothing, so
    // coming back is what asks them.
    const mint = reactivateOperation.bestaetigung;
    if (mint !== null) drainSoon();

    return {
      success: true,
      updated_document: reactivateOperation.updated_document,
      message: mint === null ? "Schiedsrichter reaktiviert" : linkSatz(mint.email),
    };
  });
}
