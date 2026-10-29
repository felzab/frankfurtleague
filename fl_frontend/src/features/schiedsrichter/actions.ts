"use server";

import { isFreshlySignedIn } from "@/core/auth";
import { refusalResult, refuseUnconfirmed, runAdminMutation } from "@/shared/utils/adminMutation";
import { refusedReplay, restored, runAdminUndo, UNDO_UNREADABLE } from "@/shared/utils/adminUndo";
import { buildRefusal, LADE_DIE_SEITE_NEU } from "@/shared/utils/refusal";
import { toFieldErrors, VALIDATION_FAILED } from "@/shared/utils/validation";

import { returnMayMint, saveMayMint } from "./linkMint";
import { deleteSchiedsrichter, einladeSchiedsrichter, patchSchiedsrichter, postSchiedsrichter, reactivateSchiedsrichter } from "./mutations";
import { describeLinkMail, mailSchiedsrichterLink } from "./notifications";
import { getSchiedsrichterById } from "./queries";
import {
  KEINE_ADRESSE,
  mapBestaetigteAdresseRefusal,
  mapEinladenRefusal,
  mapGesperrteAdresseRefusal,
  mapNameRefusal,
  mapReactivateRefusal,
  mapRetireRefusal,
  SCHIEDSRICHTER_REPLAY_REFUSALS,
} from "./refusals";
import {
  FLPatchSchiedsrichterPayloadSchema,
  FLPostSchiedsrichterPayloadSchema,
  FLSchiedsrichterEinladenPayloadSchema,
  FLSchiedsrichterKeyPayloadSchema,
  hatAdresse,
} from "./schemas";

import type { FLSchiedsrichterPayloadDraft } from "@/features/schiedsrichter/schemas";
import type { FLKontakt } from "@/shared/schemas";
import type { ActionResult } from "@/shared/types/types";
import type { UndoOutcome } from "@/shared/utils/adminUndo";
import type { LinkVersand } from "@/shared/utils/linkVersand";
import type {
  FLPatchSchiedsrichterPayload,
  FLPostSchiedsrichterPayload,
  FLSchiedsrichter,
  FLSchiedsrichterEinladenPayload,
  FLSchiedsrichterKeyPayload,
} from "./schemas";

export async function postSchiedsrichterAction(
  // The DRAFT shape: an emptied money field submits `null`, which the schema below makes a field error.
  rawPayload: FLSchiedsrichterPayloadDraft<FLPostSchiedsrichterPayload>,
): Promise<ActionResult<{ created_id: string; versand: LinkVersand }>> {
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

    const mint = postOperation.bestaetigung;
    // The address the MINT names, never the one this caller sent: only the mint's own transaction
    // can say which mailbox the credential was made for.
    const versand = await mailSchiedsrichterLink({
      operation: "postSchiedsrichterAction",
      schiedsrichterId: postOperation.created_id,
      email: mint.email,
      mint: mint,
      anlass: "empfang",
    });

    return {
      success: true,
      created_id: postOperation.created_id,
      message: describeLinkMail(mint.email, versand),
      versand: versand,
    };
  });
}

export async function patchSchiedsrichterAction(
  // The DRAFT shape: an emptied money field submits `null`, which the schema below makes a field error.
  rawPayload: FLSchiedsrichterPayloadDraft<FLPatchSchiedsrichterPayload>,
  // The send's outcome beside the message rather than a sentence the caller parses: the editor grades
  // the toast on it, and the save landed either way.
): Promise<
  ActionResult<{
    updated_document?: FLSchiedsrichter;
    versandSatz?: string;
    versand?: LinkVersand;
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
    // The address the MINT names, never the one this caller sent: a save landing between the two
    // would put the credential in the mailbox this one replaced.
    const versand =
      mint === null
        ? null
        : await mailSchiedsrichterLink({
            operation: "patchSchiedsrichterAction",
            schiedsrichterId: validated.data.id,
            email: mint.email,
            mint: mint,
            anlass: "erneut",
          });

    return {
      success: true,
      updated_document: postOperation.updated_document,
      message: "Schiedsrichter bearbeitet",
      // Its own field rather than folded into the message: the editor hands this to the undo offer,
      // and a save that mailed nothing has no sentence to hand it.
      versandSatz: mint !== null && versand !== null ? describeLinkMail(mint.email, versand) : undefined,
      versand: versand ?? undefined,
    };
  });
}

export async function undoAdminSchiedsrichterEditAction(
  // The STORED record as it stood, which the payload type cannot hold: the editor withholds an offer the schema refuses.
  rawPayload: Omit<FLPatchSchiedsrichterPayload, "name" | "kontakt"> & {
    name: string | null;
    kontakt: FLKontakt;
  },
): Promise<UndoOutcome> {
  return runAdminUndo("undoAdminSchiedsrichterEditAction", async (session) => {
    const validated = FLPatchSchiedsrichterPayloadSchema.safeParse(rawPayload);
    if (!validated.success) return { success: false, error: UNDO_UNREADABLE };
    const payload = validated.data;

    // The replay is a save, its mint judged as the save's own action judges one: without this the undo
    // is a second door to that save with no step-up.
    const stored = isFreshlySignedIn(session) ? null : await getSchiedsrichterById(payload.id);
    const unconfirmed = stored !== null && saveMayMint(stored.schiedsrichter, payload.kontakt.email) ? refuseUnconfirmed(session) : null;
    if (unconfirmed !== null) return unconfirmed;

    let operation;
    try {
      operation = await patchSchiedsrichter(payload);
    } catch (error) {
      return refusedReplay(error, SCHIEDSRICHTER_REPLAY_REFUSALS);
    }

    // The replay puts the earlier address back, which the endpoint reads as a correction and mints
    // for: unmailed, that token exists in the database alone and the referee's own link is dead.
    const mint = operation.bestaetigung;
    if (mint === null) return restored();

    const versand = await mailSchiedsrichterLink({
      operation: "undoAdminSchiedsrichterEditAction",
      schiedsrichterId: payload.id,
      // The address the MINT names, never the payload's: the replay is the older of the two reads.
      email: mint.email,
      mint: mint,
      anlass: "erneut",
    });

    // A cost either way: the undo silently replaced a live link, which is a fact about the person
    // rather than about the rows it put back.
    return restored(describeLinkMail(mint.email, versand));
  });
}

/** A row gone before a mint could read its address: both link sends meet it. */
const EINTRAG_WEG = buildRefusal({ reason: "Diesen Eintrag gibt es nicht mehr", repair: LADE_DIE_SEITE_NEU });

/**
 * The address is read BEFORE the mint, which replaces the whole block: a read failing afterwards
 * would leave the referee with no working link and no message.
 */
export async function einladeSchiedsrichterAction(
  rawPayload: FLSchiedsrichterEinladenPayload,
): Promise<ActionResult<{ versand: LinkVersand }>> {
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

    // The address the MINT read in its own transaction, never `email` above: this read is the older
    // of the two, and a save landing between them moved the mailbox the credential was made for.
    const mint = mintOperation.bestaetigung;
    const versand = await mailSchiedsrichterLink({
      operation: "einladeSchiedsrichterAction",
      schiedsrichterId: validated.data.id,
      email: mint.email,
      mint: mint,
      anlass: "erneut",
    });

    return {
      success: true,
      // Said whichever way the send went: the previous link is dead either way, which is the fact an
      // administrator has to act on when the message did not leave.
      message: `${describeLinkMail(mint.email, versand)} Der vorherige Link gilt nicht mehr.`,
      versand: versand,
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
  // The send's outcome, for the save's reason: the reactivation landed either way, and the row grades
  // its toast on the link it minted.
): Promise<ActionResult<{ updated_document?: FLSchiedsrichter; versand?: LinkVersand }>> {
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
    // coming back is what asks them. The address is the one the mint read.
    const mint = reactivateOperation.bestaetigung;
    const versand =
      mint === null
        ? null
        : await mailSchiedsrichterLink({
            operation: "reactivateSchiedsrichterAction",
            schiedsrichterId: validated.data.id,
            email: mint.email,
            mint: mint,
            anlass: "erneut",
          });

    return {
      success: true,
      updated_document: reactivateOperation.updated_document,
      message: mint === null || versand === null ? "Schiedsrichter reaktiviert" : describeLinkMail(mint.email, versand),
      versand: versand ?? undefined,
    };
  });
}
