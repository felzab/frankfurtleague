"use server";

import { headers } from "next/headers";

import { endSessionOf, requestAccountDeletion, revokeOtherSessions, sendSignInCode } from "@/core/auth";
import { asSignInIdentifier } from "@/core/emailAddress";
import { logger } from "@/core/logging";
import { recordWriteSent } from "@/core/requestScope";
import { isHeldBy, runKontoMutation, runKontoStepUp } from "@/shared/utils/kontoMutation";
import { VERSUCHE_ES_ERNEUT_SATZ } from "@/shared/utils/refusal";
import { VALIDATION_FAILED } from "@/shared/utils/validation";

import type { ActionResult, QueryResult } from "@/shared/types/types";

/** A row another device ended first, or one that was never the holder's: to the holder, a stale list. */
const SCHON_BEENDET = "Die Anmeldung war schon beendet. Lade die Seite neu.";

/**
 * Ends one of the holder's other sign-ins. By id AND the holder's own user id, so an id belonging to
 * another person ends nothing (`docs/frontend/spec.md :: I421`).
 */
export async function endAnmeldungAction(id: string): Promise<ActionResult> {
  return runKontoMutation("endAnmeldungAction", async (served) => {
    // A server action's argument is whatever a caller posted, and this one reaches a store query.
    if (typeof id !== "string" || id === "") return { success: false, error: VALIDATION_FAILED };

    // The page offers no such control for this device: its own sign-out is the bar's, which also
    // clears the cookie this row would leave dangling.
    if (id === served.session.id) return { success: false, error: VALIDATION_FAILED };

    // Named here because the sign-in store is written past the API client, which records its own writes.
    recordWriteSent();

    const ended = await endSessionOf(served.user.id, id);

    if (ended === 0) return { success: false, error: SCHON_BEENDET };

    return { success: true, message: "Abgemeldet" };
  });
}

/** Ends every sign-in of the holder's but this device's, through the library's own in-process call. */
export async function endAndereAnmeldungenAction(): Promise<ActionResult> {
  return runKontoMutation("endAndereAnmeldungenAction", async () => {
    recordWriteSent();
    await revokeOtherSessions(await headers());

    return { success: true, message: "Alle anderen abgemeldet" };
  });
}

/**
 * Whether the session a confirmation just made is the page's holder's: once the page's session has
 * ended, its challenge names nobody and any account's passkey signs its own account in
 * (`docs/frontend/spec.md :: I428`).
 */
export async function pruefeInhaberAction(inhaberId: string): Promise<QueryResult<{ gleich: boolean }>> {
  return runKontoMutation("pruefeInhaberAction", async (served) => ({ success: true, gleich: isHeldBy(served, inhaberId) }));
}

/** What the step-up's send answers: the address is the holder's own, so nothing here is withheld from them. */
const CODE_UNTERWEGS = "Ein Anmeldecode ist an Deine Adresse unterwegs.";

/**
 * Mails the holder a code to confirm themselves with. The address is the session's and never a posted one,
 * so the press mails nobody but the holder and needs no bot check (`docs/frontend/spec.md :: I624`).
 */
export async function sendeBestaetigungscodeAction(): Promise<ActionResult> {
  return runKontoStepUp("sendeBestaetigungscodeAction", async (served) => {
    try {
      // Folded as the sign-in's own send folds it, so the code row is the one the code step checks.
      await sendSignInCode(asSignInIdentifier(served.user.email), await headers());
    } catch (failed) {
      // The NAME alone: an error on this path routinely carries the address.
      logger.error("auth.sign_in_failed", undefined, { error_code: "FE-AUTH-002", name: failed instanceof Error ? failed.name : "unknown" });
      return { success: false, error: VERSUCHE_ES_ERNEUT_SATZ };
    }

    return { success: true, message: CODE_UNTERWEGS };
  });
}

/**
 * What the request answers. The library answers a send that failed as one that went, so the only remedy
 * it can offer a missing mail is a second press.
 */
const LOESCHLINK_UNTERWEGS =
  "Wir haben Dir einen Link geschickt. Erst wenn Du ihn öffnest und dort bestätigst, löschen wir Dein Konto. Kommt keine E-Mail an, fordere den Link erneut an.";

/**
 * Mails the holder a link to delete their account. The account page's guard without the step-up window
 * (`docs/frontend/spec.md :: I_NEW_S9-AUTH_3`): the link goes to the session's own mailbox, and completing it
 * takes that mailbox and the signed-in session both.
 */
export async function fordereKontoLoeschungAnAction(): Promise<ActionResult> {
  return runKontoStepUp("fordereKontoLoeschungAnAction", async () => {
    await requestAccountDeletion(await headers());

    return { success: true, message: LOESCHLINK_UNTERWEGS };
  });
}
