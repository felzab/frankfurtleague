"use server";

import { refresh } from "next/cache";
import { headers } from "next/headers";

import { deleteOwnAccount, getKontoSession } from "@/core/auth";
import { recordWriteSent } from "@/core/requestScope";
import { invalidatesOnWrite, refusalResult, stepUpRequired } from "@/shared/utils/adminMutation";
import { enrolmentUntil } from "@/shared/utils/kontoMutation";
import { runPersonRecordMutation } from "@/shared/utils/personMutation";
import { VALIDATION_FAILED } from "@/shared/utils/validation";

import { eraseEigeneDaten } from "./mutations";
import { getLoeschungAnsicht } from "./queries";
import { LETZTE_INHABERIN, mapLoeschungRefusal } from "./refusals";

import type { ActionResult } from "@/shared/types/types";

/** What the library's refusal of a link means to its holder, the token being spent before it was refused. */
const LINK_UNGUELTIG =
  "Dieser Link lässt sich nicht mehr verwenden: Er ist abgelaufen, wurde schon verwendet oder gehört zu einem anderen Konto. Fordere auf Deiner Kontoseite einen neuen an.";

/** Every other failure once the library may have spent the link, whose next press would meet `LINK_UNGUELTIG`. */
const LINK_VERBRAUCHT = "Dieser Link ist dabei verbraucht worden. Für einen neuen Versuch fordere auf Deiner Kontoseite einen neuen an.";

/**
 * Completes a mailed deletion link, the league's records before the account (`docs/frontend/spec.md ::
 * I675`). The person-record spine sends the actor the backend's person route reads, and refuses
 * sessions the library itself would accept.
 */
export async function loescheKontoAction(token: string): Promise<ActionResult> {
  // Whether the press reached the library, which may spend the link, and whether the library refused the link itself.
  const link = { spent: false, refused: false };

  const answer = await runPersonRecordMutation("loescheKontoAction", async (subject) => {
    // A server action's argument is whatever a caller posted, and this one reaches the sign-in store.
    if (typeof token !== "string" || token === "") return { success: false, error: VALIDATION_FAILED };

    // Unconditional: the erasure reaches a squad and a fixture whatever this person turns out to hold.
    invalidatesOnWrite("spieler", "spiele");

    // Refused before the library spends the link, so the same link completes once another owner is made
    // (`docs/frontend/spec.md :: I708`); the backend refuses two owners at once. Read for an owner alone,
    // the one tier that can be the last.
    if (subject.subjekt.verwaltung === "owner" && (await getLoeschungAnsicht()).letzter_inhaber) {
      return { success: false, error: LETZTE_INHABERIN };
    }

    // A grant goes with the account, so a grant holder is held to a revoke's window, a passkey confirmation
    // of the enrolment's minutes (`docs/frontend/spec.md :: I707`), judged before the library spends the link.
    if (subject.subjekt.verwaltung !== null) {
      const verwaltend = await getKontoSession();
      if (verwaltend === null || enrolmentUntil(verwaltend) === null) {
        // The page's figures read again, so its next press asks first (`docs/frontend/spec.md :: I433`).
        refresh();
        return stepUpRequired();
      }
    }

    // The token is spent in the sign-in store, written past the API client, whatever the press comes to.
    recordWriteSent();
    link.spent = true;

    let outcome;
    try {
      outcome = await deleteOwnAccount(token, await headers(), () => eraseEigeneDaten());
    } catch (error) {
      // The backend's own refusal of the last owner; every other throw is the spine's to answer.
      const refusal = mapLoeschungRefusal(error);
      if (refusal !== null) return refusalResult(refusal);
      throw error;
    }
    if (outcome === "linkRefused") {
      link.refused = true;
      return { success: false, error: LINK_UNGUELTIG };
    }

    return { success: true, message: "Dein Konto und Deine Angaben sind gelöscht." };
  });

  // Past the spend every answer but a deletion leaves a link the next press cannot take, which the spine's
  // own words, a retry's or a reload's, would hide.
  if (answer.success || !link.spent || link.refused) return answer;
  return { ...answer, error: `${answer.error} ${LINK_VERBRAUCHT}` };
}
