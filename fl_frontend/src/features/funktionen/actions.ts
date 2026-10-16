"use server";

import { deleteAccountFor, endSessionsOfAddress } from "@/core/auth";
import { logger } from "@/core/logging";
import { invalidatesOnWrite, refusalResult, runAdminMutation } from "@/shared/utils/adminMutation";
import { buildRefusal, VERSUCHE_ES_ERNEUT } from "@/shared/utils/refusal";
import { toFieldErrors, VALIDATION_FAILED } from "@/shared/utils/validation";

import { eraseAufAnfrage, readErasureAnsicht, recordAbmeldung } from "./mutations";
import { mapAbmeldungRefusal, mapErasureRefusal } from "./refusals";
import { FLAbmeldungPayloadSchema, FLErasureAnsichtPayloadSchema, FLErasurePayloadSchema } from "./schemas";

import type { FLErasureResponse } from "@/core/schemas";
import type { ActionResult, QueryResult } from "@/shared/types/types";
import type { FLAbmeldungPayload, FLErasureAnsichtPayload, FLErasureAnsichtResponse, FLErasurePayload } from "./schemas";

/** What became of the address's sign-in account once its league records were gone. */
export type KontoNachLoeschung = "geloescht" | "keines" | "nichtGeloescht";

/** Whether the erasure removed or emptied anything, read off every count it answers, one added later included. */
const loeschteEtwas = ({ acknowledged: _umschlag, ...anzahlen }: FLErasureResponse): boolean =>
  Object.values(anzahlen).some((anzahl) => anzahl > 0);

/**
 * The account's deletion, once the backend has answered. A failure leaves the records gone and the account standing,
 * which a repeat completes: an emptied address is answered with every count zero rather than refused.
 */
async function kontoLoeschen(email: string): Promise<KontoNachLoeschung> {
  try {
    return (await deleteAccountFor(email)) ? "geloescht" : "keines";
  } catch (failed) {
    // The NAME alone: a failure in the sign-in store routinely carries the address.
    logger.error("funktionen.erasure_account_not_deleted", undefined, {
      error_code: "FE-AUTH-012",
      name: failed instanceof Error ? failed.name : "unknown",
    });
    return "nichtGeloescht";
  }
}

/** The sentence each outcome is told in, beside the title the panel gives it. */
function loeschungSatz(konto: KontoNachLoeschung, gespeichert: boolean): string {
  if (konto === "nichtGeloescht") {
    return "Die Daten sind gelöscht, das Konto der Adresse aber nicht. Lösche die Adresse erneut, dann wird auch das Konto gelöscht.";
  }
  // Never „nichts gespeichert“: the log and the address's authorship were rewritten anyway, and no count says what they held.
  if (!gespeichert && konto === "keines") {
    return "Unter dieser Adresse war kein Eintrag gespeichert, und sie hatte kein Konto. Im Änderungsprotokoll und als Urheberin von Sperren, Einladungen, Entscheidungen und Zugängen ist sie trotzdem gelöscht.";
  }

  const kontoSatz = konto === "geloescht" ? "Das Konto der Adresse ist gelöscht." : "Die Adresse hatte kein Konto.";
  return `Alles, was unter der Adresse gespeichert war, ist gelöscht. ${kontoSatz}`;
}

/**
 * Whom the erasure would reach, read as its panel arms. It refuses what the erasure refuses, so the panel says so
 * before anyone confirms a press the backend would turn away.
 */
export async function readErasureAnsichtAction(
  rawPayload: FLErasureAnsichtPayload,
): Promise<QueryResult<{ ansicht: FLErasureAnsichtResponse }>> {
  return runAdminMutation("readErasureAnsichtAction", async () => {
    const validated = FLErasureAnsichtPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return {
        success: false,
        error: VALIDATION_FAILED,
        fieldErrors: toFieldErrors(validated.error),
      };
    }

    try {
      return { success: true, ansicht: await readErasureAnsicht(validated.data) };
    } catch (error) {
      const refusal = mapErasureRefusal(error);
      if (refusal !== null) return refusalResult(refusal);
      throw error;
    }
  });
}

/**
 * Erases every league record an address holds, then its sign-in account (`docs/frontend/spec.md :: I685`).
 * **Permanent, with no undo**, and mailing nobody: the request it answers arrived by mail, outside this site.
 */
export async function eraseAufAnfrageAction(
  rawPayload: FLErasurePayload,
): Promise<ActionResult<{ konto: KontoNachLoeschung; gespeichert: boolean }>> {
  return runAdminMutation("eraseAufAnfrageAction", { stepUp: true }, async () => {
    // Before anything is awaited, and whatever the address turns out to hold: an erased pupil or referee leaves two
    // cached public reads, and the spine drops a tag declared before the write even where its answer is lost.
    invalidatesOnWrite("spieler", "spiele");

    const validated = FLErasurePayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return {
        success: false,
        error: VALIDATION_FAILED,
        fieldErrors: toFieldErrors(validated.error),
      };
    }

    // The records first: an account deleted ahead of a refused or failed erasure leaves a person whose data stands
    // and who then cannot sign in to ask again.
    let erasure: FLErasureResponse;
    try {
      erasure = await eraseAufAnfrage(validated.data);
    } catch (error) {
      const refusal = mapErasureRefusal(error);
      if (refusal !== null) return refusalResult(refusal);
      throw error;
    }

    if (!erasure.acknowledged) {
      return { success: false, error: buildRefusal({ reason: "Die Person wurde nicht gelöscht", repair: VERSUCHE_ES_ERNEUT }) };
    }

    const konto = await kontoLoeschen(validated.data.email);
    const gespeichert = loeschteEtwas(erasure);

    // Counts and never the person: a report repeating them hands back a copy of what the erasure destroyed.
    return { success: true, konto: konto, gespeichert: gespeichert, message: loeschungSatz(konto, gespeichert) };
  });
}

const ANMELDUNGEN_NICHT_BEENDET = "Laufende Anmeldungen der Adresse konnten nicht beendet werden.";

/**
 * Ends every session of an address without barring it and without a mail (`docs/frontend/spec.md :: I687`). No
 * step-up: a session ended is repaired by signing in again, as the ban's own sign-out is.
 */
export async function endAnmeldungenAction(rawPayload: FLAbmeldungPayload): Promise<ActionResult<{ konto: boolean }>> {
  return runAdminMutation("endAnmeldungenAction", async () => {
    const validated = FLAbmeldungPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return {
        success: false,
        error: VALIDATION_FAILED,
        fieldErrors: toFieldErrors(validated.error),
      };
    }

    // The log's row first: the backend judges whose address it is, and a sign-out it refuses ends nothing.
    try {
      await recordAbmeldung(validated.data);
    } catch (error) {
      const refusal = mapAbmeldungRefusal(error);
      if (refusal !== null) return refusalResult(refusal);
      throw error;
    }

    let konto: boolean;
    try {
      konto = await endSessionsOfAddress(validated.data.email);
    } catch (failed) {
      // The NAME alone, as the ban's own sign-out logs it: the address must reach no line.
      logger.error("funktionen.sessions_not_ended", undefined, {
        error_code: "FE-AUTH-006",
        name: failed instanceof Error ? failed.name : "unknown",
      });
      return { success: false, error: ANMELDUNGEN_NICHT_BEENDET };
    }

    return {
      success: true,
      konto: konto,
      message: konto ? "Jede Anmeldung der Adresse ist beendet." : "Die Adresse hat kein Konto. Es gab nichts zu beenden.",
    };
  });
}
