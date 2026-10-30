"use server";

import { drainSoon } from "@/core/afterResponse";
import { accountStandsAt, endSessionsOfAddress } from "@/core/auth";
import { logger } from "@/core/logging";
import { readErasureAnsicht } from "@/features/funktionen/mutations";
import { refusalResult, runAdminMutation } from "@/shared/utils/adminMutation";
import { toFieldErrors, VALIDATION_FAILED } from "@/shared/utils/validation";

import { SPERRE_ERFOLG } from "./constants";
import { deleteSperre, postSperre } from "./mutations";
import { mapAnsichtRefusal, mapSperreRefusal, schonGesperrtAmFeld, verwaltungAmFeld } from "./refusals";
import { FLPostSperrlistePayloadSchema, FLSperrlisteKeyPayloadSchema } from "./schemas";

import type { FLErasureAnsichtResponse } from "@/core/generated/client/types";
import type { ActionResult, QueryResult } from "@/shared/types/types";
import type { FLSperrlisteKeyPayload, SperreEntwurf } from "./schemas";

/**
 * Every record the address holds, as the erasure's reveal names them. No grant and no ban among them: the read answers an
 * address holding either with the ban's own refusal (`REQ-SPERRLISTE-003`, `REQ-SPERRLISTE-001`).
 */
export type SperreAnsicht = Omit<FLErasureAnsichtResponse, "verwaltung" | "gesperrt">;

/** The ban's own address rule, never the erasure's looser lookup: no list is read for an address the ban would refuse. */
const AnsichtPayloadSchema = FLPostSperrlistePayloadSchema.pick({ email: true });

const SPERRE_STEHT = "Die Sperre steht.";
const NICHT_BENACHRICHTIGT = "Die Benachrichtigung an die Adresse konnte nicht verschickt werden.";
// Said rather than left to a clean save, which an administrator reads as the barred person mailed.
const KEIN_KONTO = "Die Adresse hat kein Konto, deshalb wurde sie nicht benachrichtigt.";

const ANMELDUNGEN_NICHT_BEENDET = "Laufende Anmeldungen der Adresse konnten nicht beendet werden.";

/**
 * Ends the address's live sessions, which the refusal of every next sign-in does not reach.
 * A failure leaves the ban standing, as a failed notice does.
 */
async function abmelden(email: string): Promise<string | null> {
  try {
    await endSessionsOfAddress(email);
    return null;
  } catch (failed) {
    // The NAME alone: the address must reach no line.
    logger.error("sperrliste.sessions_not_ended", undefined, {
      name: failed instanceof Error ? failed.name : "unknown",
    });
    return ANMELDUNGEN_NICHT_BEENDET;
  }
}

/**
 * Whether the address holds an account, which alone is told of its ban: `null` where the store did not say, and nobody
 * is then told, the notice's account sentences being a guess.
 */
async function kontoBesteht(email: string): Promise<boolean | null> {
  try {
    return await accountStandsAt(email);
  } catch (failed) {
    logger.error("sperrliste.account_unread", undefined, { name: failed instanceof Error ? failed.name : "unknown" });
    return null;
  }
}

/**
 * What the address holds, read for the ban's dialog ahead of the ban: the erasure's
 * own reveal, every record it names being one the ban leaves standing.
 */
export async function readSperreAnsichtAction(rawPayload: Pick<SperreEntwurf, "email">): Promise<QueryResult<{ ansicht: SperreAnsicht }>> {
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

export async function postSperreAction(rawPayload: SperreEntwurf): Promise<ActionResult<{ warn: boolean }>> {
  return runAdminMutation("postSperreAction", { stepUp: true }, async () => {
    const validated = FLPostSperrlistePayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return {
        success: false,
        error: VALIDATION_FAILED,
        fieldErrors: toFieldErrors(validated.error),
      };
    }

    // Read before the write, so the ban owes its own notice in its own transaction where an account stands.
    const konto = await kontoBesteht(validated.data.email);

    // The refusal belongs on the box holding the value it refuses, not on the error page.
    try {
      await postSperre({ ...validated.data, benachrichtigen: konto === true });
    } catch (error) {
      const refusal = mapSperreRefusal(error);
      if (refusal) return refusalResult(refusal);
      throw error;
    }

    // AFTER the write is acknowledged, so nobody is signed out by a request that then failed.
    const abgemeldet = await abmelden(validated.data.email);
    if (konto === true) drainSoon();

    // Each is told, and none undoes the ban: the write is acknowledged and no address survives to retry a failure with.
    const told = [abgemeldet, konto === null ? NICHT_BENACHRICHTIGT : konto ? null : KEIN_KONTO].filter((sentence) => sentence !== null);

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
