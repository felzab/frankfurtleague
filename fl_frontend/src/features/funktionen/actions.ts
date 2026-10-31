"use server";

import { deleteAccountFor, endSessionsOfAddress } from "@/core/auth";
import { RolledBackError } from "@/core/errors";
import { logger } from "@/core/logging";
import { isWithinEnrolmentWindow } from "@/core/sessionLifetimes";
import { HANDLUNGSBEDARF_EINTRAG } from "@/features/admin/constants";
import { refusalResult, refuseUnconfirmed, runAdminMutation } from "@/shared/utils/adminMutation";
import { toFieldErrors, VALIDATION_FAILED } from "@/shared/utils/validation";

import { loeschenAufAnfrage, readLoeschungAnsicht, recordAbmeldung } from "./mutations";
import { mapAbmeldungRefusal, mapLoeschungAufAnfrageRefusal } from "./refusals";
import { FLLoeschungAdressePayloadSchema, FLLoeschungPayloadSchema } from "./schemas";

import type { FLErasureAdressePayload, FLErasurePayload, FLErasureResponse, FLErasureViewResponse } from "@/core/generated/client/types";
import type { ActionResult, QueryResult } from "@/shared/types/types";

/** What became of the address's sign-in account once its league records were gone. */
export type KontoNachLoeschung = "geloescht" | "keines" | "nichtGeloescht" | "unklar";

/** Whether the erasure removed or emptied anything, read off every count it answers, one added later included. */
const loeschteEtwas = (anzahlen: FLErasureResponse): boolean => Object.values(anzahlen).some((anzahl) => anzahl > 0);

/**
 * The account's deletion, once the backend has answered. A failure leaves the records gone and the account standing,
 * or past a failed commit perhaps not, which a repeat completes: an emptied address is answered with zeros rather than refused.
 */
async function kontoLoeschen(email: string): Promise<KontoNachLoeschung> {
  try {
    return (await deleteAccountFor(email)) ? "geloescht" : "keines";
  } catch (failed) {
    // The NAME alone: a failure in the sign-in store routinely carries the address.
    logger.error("roles.erasure_account_not_deleted", undefined, {
      name: failed instanceof Error ? failed.name : "unknown",
    });
    // A rollback leaves the account standing; any other failure may be its commit's, landed or not.
    return failed instanceof RolledBackError ? "nichtGeloescht" : "unklar";
  }
}

/** The sentence each outcome is told in, beside the title the panel gives it. */
function loeschungSatz(konto: KontoNachLoeschung, gespeichert: boolean, spiele: number): string {
  // The one sentence an administrator acts on afterwards: an unplayed fixture of an erased referee stands unassigned.
  // Conditional, as `spiele` counts the played fixtures moved onto the ghost too.
  const folge =
    spiele > 0
      ? ` War diese Person für Spiele ohne Ergebnis eingeteilt, brauchen diese Spiele eine neue Einteilung. Du findest sie unter „${HANDLUNGSBEDARF_EINTRAG.label}“.`
      : "";

  if (konto === "nichtGeloescht") {
    return `Die Daten sind gelöscht, das Konto der Adresse aber nicht. Lösche die Adresse erneut, dann wird auch das Konto gelöscht.${folge}`;
  }
  if (konto === "unklar") {
    return `Die Daten sind gelöscht. Ob auch das Konto der Adresse gelöscht wurde, ist unklar. Lösche die Adresse erneut, dann wird ein verbliebenes Konto auch gelöscht.${folge}`;
  }
  // Never „nichts gespeichert“: the log and the address's authorship were rewritten anyway, and no count says what they held.
  if (!gespeichert && konto === "keines") {
    return "Unter dieser Adresse war kein Eintrag gespeichert, und sie hatte kein Konto. Im Änderungsprotokoll und als Urheberin von Sperren, Einladungen, Entscheidungen und Zugängen ist sie trotzdem gelöscht.";
  }

  const kontoSatz = konto === "geloescht" ? "Das Konto der Adresse ist gelöscht." : "Die Adresse hatte kein Konto.";
  return `Alles, was unter der Adresse gespeichert war, ist gelöscht. ${kontoSatz}${folge}`;
}

/**
 * Whom the erasure would reach, read as its panel arms. It refuses what the erasure refuses, so the panel says so
 * before anyone confirms a press the backend would turn away.
 */
export async function readLoeschungAnsichtAction(
  rawPayload: FLErasureAdressePayload,
): Promise<QueryResult<{ ansicht: FLErasureViewResponse }>> {
  return runAdminMutation("readLoeschungAnsichtAction", async () => {
    const validated = FLLoeschungAdressePayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return {
        success: false,
        error: VALIDATION_FAILED,
        fieldErrors: toFieldErrors(validated.error),
      };
    }

    try {
      return { success: true, ansicht: await readLoeschungAnsicht(validated.data) };
    } catch (error) {
      const refusal = mapLoeschungAufAnfrageRefusal(error);
      if (refusal !== null) return refusalResult(refusal);
      throw error;
    }
  });
}

/**
 * Erases every league record an address holds, then its sign-in account.
 * **Permanent, with no undo**, and mailing nobody: the request it answers arrived by mail, outside this site.
 */
export async function loeschenAufAnfrageAction(
  rawPayload: FLErasurePayload,
): Promise<ActionResult<{ konto: KontoNachLoeschung; gespeichert: boolean }>> {
  return runAdminMutation("loeschenAufAnfrageAction", { stepUp: true }, async (session) => {
    const validated = FLLoeschungPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return {
        success: false,
        error: VALIDATION_FAILED,
        fieldErrors: toFieldErrors(validated.error),
      };
    }

    let loeschung: FLErasureResponse;
    try {
      // A grant holder's address is held to the enrolment's window on both servers, so a
      // grant written since the panel's read is refused here too. Read only for a session past that window.
      const haeltZugang =
        !isWithinEnrolmentWindow(session.session.createdAt) &&
        // The panel's reveal, never the subject lookup, which refuses an address stored under an older rule the erasure takes.
        (await readLoeschungAnsicht({ email: validated.data.email })).verwaltung !== null;
      const unconfirmed = haeltZugang ? refuseUnconfirmed(session, "enrolment") : null;
      if (unconfirmed !== null) return unconfirmed;

      // The records first: an account deleted ahead of a refused or failed erasure leaves a person whose data stands
      // and who then cannot sign in to ask again.
      loeschung = await loeschenAufAnfrage(validated.data);
    } catch (error) {
      const refusal = mapLoeschungAufAnfrageRefusal(error);
      if (refusal !== null) return refusalResult(refusal);
      throw error;
    }

    const konto = await kontoLoeschen(validated.data.email);
    const gespeichert = loeschteEtwas(loeschung);

    // Counts and never the person: a report repeating them hands back a copy of what the erasure destroyed.
    return { success: true, konto: konto, gespeichert: gespeichert, message: loeschungSatz(konto, gespeichert, loeschung.spiele) };
  });
}

const ANMELDUNGEN_NICHT_BEENDET = "Laufende Anmeldungen der Adresse konnten nicht beendet werden.";

/**
 * Ends every session of an address without barring it and without a mail. A step-up
 * write: nothing brings an ended session back, and unasked, a stolen session could sign administrators out again and again.
 */
export async function endAnmeldungenAction(rawPayload: FLErasureAdressePayload): Promise<ActionResult<{ konto: boolean }>> {
  return runAdminMutation("endAnmeldungenAction", { stepUp: true }, async () => {
    const validated = FLLoeschungAdressePayloadSchema.safeParse(rawPayload);

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
      logger.error("roles.sessions_not_ended", undefined, {
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
