"use server";

import { frontend_config } from "@/core/config";
import { logger } from "@/core/logging";
import { sendMail } from "@/core/mail";
import { buildSperreEmail } from "@/core/sperrlisteEmail";
import { refusalResult, runAdminMutation } from "@/shared/utils/adminMutation";
import { buildRefusal } from "@/shared/utils/refusal";
import { toFieldErrors, VALIDATION_FAILED } from "@/shared/utils/validation";

import { SPERRE_ERFOLG } from "./constants";
import { deleteSperre, postSperre } from "./mutations";
import { mapAdresseRefusal } from "./refusals";
import { FLPostSperrlistePayloadSchema, FLSperrlisteKeyPayloadSchema } from "./schemas";

import type { ActionResult } from "@/shared/types/types";
import type { FLPostSperrlistePayload, FLSperrlisteKeyPayload } from "./schemas";

const NICHT_BENACHRICHTIGT = "Die Sperre steht. Die Benachrichtigung an die Adresse konnte nicht zugestellt werden.";

/**
 * The typed address is on no row, in no log line and in no error message, so this send is the one
 * use it is ever put to.
 */
// A failure leaves the ban standing rather than undoing it: the write is acknowledged and no address
// survives to re-send to, so the administrator is told instead.
async function benachrichtigen(email: string, grund: string, gesperrtBisSaisonId: string): Promise<boolean> {
  const { subject, html, text } = buildSperreEmail({
    grund: grund,
    gesperrtBisSaisonId: gesperrtBisSaisonId,
    origin: frontend_config.AUTH_URL,
  });

  try {
    await sendMail({ to: email, subject: subject, html: html, text: text });

    return true;
  } catch (failed) {
    // The NAME alone: a failure on this path routinely carries the address, and
    // `fl_frontend/src/core/logFormat.ts :: serializeError` writes a message and a stack in full.
    logger.error("sperrliste.notice_failed", undefined, {
      error_code: "FE-MAIL-008",
      name: failed instanceof Error ? failed.name : "unknown",
    });

    return false;
  }
}

export async function postSperreAction(rawPayload: FLPostSperrlistePayload): Promise<ActionResult<{ created_id: string }>> {
  return runAdminMutation("postSperreAction", { readOnly: false }, async () => {
    const validated = FLPostSperrlistePayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return {
        success: false,
        error: VALIDATION_FAILED,
        fieldErrors: toFieldErrors(validated.error),
      };
    }

    // The refusal belongs on the box that holds the address, not on the error page.
    let postOperation;
    try {
      postOperation = await postSperre(validated.data);
    } catch (error) {
      const refusal = mapAdresseRefusal(error);
      if (refusal) return refusalResult(refusal);
      throw error;
    }

    if (!postOperation.acknowledged) {
      return { success: false, error: buildRefusal({ reason: "Die Adresse wurde nicht gesperrt", repair: "Versuche es erneut" }) };
    }

    // AFTER the write is acknowledged, so nobody is told they are barred by a request that then
    // failed, and on the response's own bound rather than a second read the sweep could beat.
    const benachrichtigt = await benachrichtigen(validated.data.email, validated.data.grund, postOperation.gesperrt_bis_saison_id);

    return { success: true, created_id: postOperation.created_id, message: benachrichtigt ? SPERRE_ERFOLG : NICHT_BENACHRICHTIGT };
  });
}

/**
 * No tag moves: the ban list reaches no cached read, and the spine's refresh is for the admin's own
 * uncached list. A row another administrator has already lifted answers 404, which
 * `fl_frontend/src/shared/utils/actionError.ts` words as the reload it is.
 */
export async function deleteSperreAction(rawPayload: FLSperrlisteKeyPayload): Promise<ActionResult> {
  return runAdminMutation("deleteSperreAction", { readOnly: false }, async () => {
    const validated = FLSperrlisteKeyPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return {
        success: false,
        error: VALIDATION_FAILED,
        fieldErrors: toFieldErrors(validated.error),
      };
    }

    const deleteOperation = await deleteSperre(validated.data);

    if (!deleteOperation.acknowledged) {
      return { success: false, error: buildRefusal({ reason: "Die Sperre wurde nicht aufgehoben", repair: "Versuche es erneut" }) };
    }

    return { success: true, message: "Diese Adresse wird nicht mehr abgewiesen." };
  });
}
