"use server";

import { endSessionsOfAddress } from "@/core/auth";
import { frontend_config } from "@/core/config";
import { logger } from "@/core/logging";
import { sendSperreNotice } from "@/core/mail";
import { runAnsweringOwnCut } from "@/core/requestScope";
import { versandAusfallOf } from "@/core/versandAusfall";
import { ZURUECKGEHALTEN } from "@/features/einladungen/meldungen";
import { refusalResult, runAdminMutation } from "@/shared/utils/adminMutation";
import { buildRefusal, VERSUCHE_ES_ERNEUT } from "@/shared/utils/refusal";
import { toFieldErrors, VALIDATION_FAILED } from "@/shared/utils/validation";

import { SPERRE_ERFOLG } from "./constants";
import { deleteSperre, postSperre } from "./mutations";
import { mapAdresseRefusal } from "./refusals";
import { FLPostSperrlistePayloadSchema, FLSperrlisteKeyPayloadSchema } from "./schemas";

import type { ActionResult } from "@/shared/types/types";
import type { FLPostSperrlistePayload, FLSperrlisteKeyPayload } from "./schemas";

const SPERRE_STEHT = "Die Sperre steht.";
const NICHT_BENACHRICHTIGT = "Die Benachrichtigung an die Adresse konnte nicht zugestellt werden.";
const BENACHRICHTIGUNG_UNKLAR = "Ob die Benachrichtigung angekommen ist, ist unklar.";
// Said rather than left to a clean save, which an administrator reads as the barred person mailed.
const KEIN_KONTO = "Die Adresse hat kein Konto, deshalb wurde sie nicht benachrichtigt.";

const ANMELDUNGEN_NICHT_BEENDET = "Laufende Anmeldungen der Adresse konnten nicht beendet werden.";

/** What the sign-out found: whether an account holds the address, `null` where the store did not say, and the sentence a failure owes. */
type Abmeldung = { readonly konto: boolean | null; readonly satz: string | null };

/**
 * Ends the address's live sessions, which the refusal of every next sign-in does not reach
 * (`docs/frontend/spec.md :: I402`). A failure leaves the ban standing, as a failed notice does.
 */
async function abmelden(email: string): Promise<Abmeldung> {
  try {
    return { konto: await endSessionsOfAddress(email), satz: null };
  } catch (failed) {
    // The NAME alone, as the notice's own failure is logged: the address must reach no line.
    logger.error("sperrliste.sessions_not_ended", undefined, {
      error_code: "FE-AUTH-006",
      name: failed instanceof Error ? failed.name : "unknown",
    });
    return { konto: null, satz: ANMELDUNGEN_NICHT_BEENDET };
  }
}

/**
 * The typed address is on no row, in no log line and in no error message, so this send and the
 * sign-out above are the only uses it is ever put to.
 */
// A failure leaves the ban standing rather than undoing it: the write is acknowledged and no address
// survives to re-send to, so the administrator is told instead.
async function benachrichtigen(email: string, grund: string, gesperrtBisSaisonId: string): Promise<string | null> {
  // The notice's own sender, the one past the ban list: the address it goes to is now on it
  // (`docs/frontend/spec.md :: I541`).
  try {
    // Unwrapped, a deadline cut here answers the whole press as of unknown outcome, sending the administrator to
    // check a ban written before this send (`docs/frontend/spec.md :: I372`).
    await runAnsweringOwnCut(() =>
      sendSperreNotice({ to: email, grund: grund, gesperrtBisSaisonId: gesperrtBisSaisonId, origin: frontend_config.AUTH_URL }),
    );

    return null;
  } catch (failed) {
    // Filed by a deployment that mails nothing, which the mailer's own line records: no failure, and
    // nobody to tell by hand.
    // The ban's own notice passes the ban list, so the one reading never answers `gesperrt` here.
    const ausfall = versandAusfallOf(failed);
    if (ausfall === "zurueckgehalten") return ZURUECKGEHALTEN;

    // The NAME alone: a failure on this path routinely carries the address, and
    // `fl_frontend/src/core/logFormat.ts :: serializeError` writes a message and a stack in full.
    logger.error("sperrliste.notice_failed", undefined, {
      error_code: "FE-MAIL-008",
      name: failed instanceof Error ? failed.name : "unknown",
    });
    // A connection broken after the send left may be a message the provider accepted, as the fan-outs
    // settle it. Only the notice is unclear: the ban's own write was acknowledged, so the press saved.
    return ausfall === "ungewiss" ? BENACHRICHTIGUNG_UNKLAR : NICHT_BENACHRICHTIGT;
  }
}

export async function postSperreAction(rawPayload: FLPostSperrlistePayload): Promise<ActionResult<{ created_id: string }>> {
  return runAdminMutation("postSperreAction", async () => {
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
      return { success: false, error: buildRefusal({ reason: "Die Adresse wurde nicht gesperrt", repair: VERSUCHE_ES_ERNEUT }) };
    }

    // AFTER the write is acknowledged, so nobody is signed out or told they are barred by a request
    // that then failed; the sign-out first, so the notice's account of it is already true.
    const abgemeldet = await abmelden(validated.data.email);

    // Only an address an account holds is mailed (`docs/frontend/spec.md :: I517`). Where the store did
    // not say, nobody is, the notice's account sentences being a guess; either way the administrator is told.
    let benachrichtigt: string | null = abgemeldet.konto === null ? NICHT_BENACHRICHTIGT : KEIN_KONTO;
    if (abgemeldet.konto === true) {
      // On the response's own bound rather than a second read the sweep could beat.
      benachrichtigt = await benachrichtigen(validated.data.email, validated.data.grund, postOperation.gesperrt_bis_saison_id);
    }

    // Each is told, and none undoes the ban: the write is acknowledged and no address survives to retry
    // a failure with.
    const told = [abgemeldet.satz, benachrichtigt].filter((sentence) => sentence !== null);
    const message = told.length === 0 ? SPERRE_ERFOLG : [SPERRE_STEHT, ...told].join(" ");

    return { success: true, created_id: postOperation.created_id, message: message };
  });
}

/**
 * No tag moves: the ban list reaches no cached read, and the spine's refresh is for the admin's own
 * uncached list. A row another administrator has already lifted answers 404, which
 * `fl_frontend/src/shared/utils/actionError.ts` words as the reload it is.
 */
export async function deleteSperreAction(rawPayload: FLSperrlisteKeyPayload): Promise<ActionResult> {
  return runAdminMutation("deleteSperreAction", { stepUp: true }, async () => {
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
      return { success: false, error: buildRefusal({ reason: "Die Sperre wurde nicht aufgehoben", repair: VERSUCHE_ES_ERNEUT }) };
    }

    return { success: true, message: "Diese Adresse wird nicht mehr abgewiesen." };
  });
}
