"use server";

import { endSessionsOfAddress } from "@/core/auth";
import { frontend_config } from "@/core/config";
import { logger } from "@/core/logging";
import { sendSperreNotice } from "@/core/mail";
import { runAnsweringOwnCut } from "@/core/requestScope";
import { versandAusfallOf } from "@/core/versandAusfall";
import { ZURUECKGEHALTEN } from "@/features/einladungen/meldungen";
import { readErasureAnsicht } from "@/features/funktionen/mutations";
import { refusalResult, runAdminMutation } from "@/shared/utils/adminMutation";
import { toFieldErrors, VALIDATION_FAILED } from "@/shared/utils/validation";

import { SPERRE_ERFOLG } from "./constants";
import { deleteSperre, postSperre } from "./mutations";
import { mapAnsichtRefusal, mapSperreRefusal, schonGesperrtAmFeld, verwaltungAmFeld } from "./refusals";
import { FLPostSperrlistePayloadSchema, FLSperrlisteKeyPayloadSchema } from "./schemas";

import type { FLErasureAnsichtResponse, FLPostSperrlistePayload } from "@/core/generated/client/types";
import type { ActionResult, QueryResult } from "@/shared/types/types";
import type { FLSperrlisteKeyPayload } from "./schemas";

/**
 * Every record the address holds, as the erasure's reveal names them. No grant and no ban among them: the read answers an
 * address holding either with the ban's own refusal (`REQ-SPERRLISTE-003`, `REQ-SPERRLISTE-001`).
 */
export type SperreAnsicht = Omit<FLErasureAnsichtResponse, "verwaltung" | "gesperrt">;

/** The ban's own address rule, never the erasure's looser lookup: no list is read for an address the ban would refuse. */
const AnsichtPayloadSchema = FLPostSperrlistePayloadSchema.pick({ email: true });

const SPERRE_STEHT = "Die Sperre steht.";
const NICHT_BENACHRICHTIGT = "Die Benachrichtigung an die Adresse konnte nicht verschickt werden.";
const BENACHRICHTIGUNG_UNKLAR = "Ob die Benachrichtigung angekommen ist, ist unklar.";
// Said rather than left to a clean save, which an administrator reads as the barred person mailed.
const KEIN_KONTO = "Die Adresse hat kein Konto, deshalb wurde sie nicht benachrichtigt.";

const ANMELDUNGEN_NICHT_BEENDET = "Laufende Anmeldungen der Adresse konnten nicht beendet werden.";

/** What the sign-out found: whether an account holds the address, `null` where the store did not say, and the sentence a failure owes. */
type Abmeldung = { readonly konto: boolean | null; readonly satz: string | null };

/**
 * Ends the address's live sessions, which the refusal of every next sign-in does not reach.
 * A failure leaves the ban standing, as a failed notice does.
 */
async function abmelden(email: string): Promise<Abmeldung> {
  try {
    return { konto: await endSessionsOfAddress(email), satz: null };
  } catch (failed) {
    // The NAME alone, as the notice's own failure is logged: the address must reach no line.
    logger.error("sperrliste.sessions_not_ended", undefined, {
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
  // The notice's own sender, the one past the ban list: the address it goes to is now on it.
  try {
    // Unwrapped, a deadline cut here answers the whole press as of unknown outcome, sending the administrator to
    // check a ban written before this send.
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
    // `fl_frontend/src/core/logging.ts` writes its message and stack, an address alone scrubbed.
    logger.error("sperrliste.notice_failed", undefined, {
      name: failed instanceof Error ? failed.name : "unknown",
    });
    // A connection broken after the send left may be a message the provider accepted, as the fan-outs
    // settle it. Only the notice is unclear: the ban's own write was acknowledged, so the press saved.
    return ausfall === "ungewiss" ? BENACHRICHTIGUNG_UNKLAR : NICHT_BENACHRICHTIGT;
  }
}

/**
 * What the address holds, read for the ban's dialog ahead of the ban: the erasure's
 * own reveal, every record it names being one the ban leaves standing.
 */
export async function readSperreAnsichtAction(
  rawPayload: Pick<FLPostSperrlistePayload, "email">,
): Promise<QueryResult<{ ansicht: SperreAnsicht }>> {
  return runAdminMutation("readSperreAnsichtAction", async () => {
    const validated = AnsichtPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return {
        success: false,
        error: VALIDATION_FAILED,
        fieldErrors: toFieldErrors(validated.error),
      };
    }

    let gelesen: FLErasureAnsichtResponse;
    try {
      gelesen = await readErasureAnsicht(validated.data);
    } catch (error) {
      const refusal = mapAnsichtRefusal(error);
      if (refusal !== null) return refusalResult(refusal);
      throw error;
    }

    // Refused rather than listed, in the ban's own order: the ban refuses an address holding a grant or barred already,
    // so its list would be work for nothing.
    const { verwaltung, gesperrt, ...ansicht } = gelesen;
    if (verwaltung !== null) return refusalResult(verwaltungAmFeld());
    if (gesperrt) return refusalResult(schonGesperrtAmFeld());

    return { success: true, ansicht: ansicht };
  });
}

export async function postSperreAction(rawPayload: FLPostSperrlistePayload): Promise<ActionResult<{ warn: boolean }>> {
  return runAdminMutation("postSperreAction", { stepUp: true }, async () => {
    const validated = FLPostSperrlistePayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return {
        success: false,
        error: VALIDATION_FAILED,
        fieldErrors: toFieldErrors(validated.error),
      };
    }

    // The refusal belongs on the box holding the value it refuses, not on the error page.
    let postOperation;
    try {
      postOperation = await postSperre(validated.data);
    } catch (error) {
      const refusal = mapSperreRefusal(error);
      if (refusal) return refusalResult(refusal);
      throw error;
    }

    // AFTER the write is acknowledged, so nobody is signed out or told they are barred by a request
    // that then failed; the sign-out first, so the notice's account of it is already true.
    const abgemeldet = await abmelden(validated.data.email);

    // Only an address an account holds is mailed. Where the store did
    // not say, nobody is, the notice's account sentences being a guess; either way the administrator is told.
    let benachrichtigt: string | null = abgemeldet.konto === null ? NICHT_BENACHRICHTIGT : KEIN_KONTO;
    if (abgemeldet.konto === true) {
      // On the response's own bound rather than a second read the sweep could beat.
      benachrichtigt = await benachrichtigen(validated.data.email, validated.data.grund, postOperation.gesperrt_bis_saison_id);
    }

    // Each is told, and none undoes the ban: the write is acknowledged and no address survives to retry
    // a failure with.
    const told = [abgemeldet.satz, benachrichtigt].filter((sentence) => sentence !== null);

    return {
      success: true,
      message: told.length === 0 ? SPERRE_ERFOLG : [SPERRE_STEHT, ...told].join(" "),
      // A warning wherever a sign-out or a notice the dialog's hint promises did not happen.
      // An address no account holds is mailed by nobody, as that hint says, so its sentence alone leaves the ban clean.
      warn: told.some((sentence) => sentence !== KEIN_KONTO),
    };
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

    await deleteSperre(validated.data);

    return { success: true, message: "Diese Adresse wird nicht mehr abgewiesen." };
  });
}
