"use server";

import { headers } from "next/headers";

import { deleteOwnAccount } from "@/core/auth";
import { recordWriteSent } from "@/core/requestScope";
import { invalidatesOnWrite } from "@/shared/utils/adminMutation";
import { KONTO_FORBIDDEN } from "@/shared/utils/kontoMutation";
import { runPersonRecordMutation } from "@/shared/utils/personMutation";
import { VALIDATION_FAILED } from "@/shared/utils/validation";

import { eraseEigeneDaten } from "./mutations";

import type { ActionResult } from "@/shared/types/types";

/** What the library's refusal of a link means to its holder, the token being spent before it was refused. */
const LINK_UNGUELTIG =
  "Dieser Link lässt sich nicht mehr verwenden: Er ist abgelaufen, wurde schon verwendet oder gehört zu einem anderen Konto. Fordere auf Deiner Kontoseite einen neuen an.";

/**
 * Completes a mailed deletion link, the league's records before the account (`docs/frontend/spec.md ::
 * I675`). The person-record spine sends the actor the backend's person route reads, and refuses
 * sessions the library itself would accept.
 */
export async function loescheKontoAction(token: string): Promise<ActionResult> {
  return runPersonRecordMutation("loescheKontoAction", async (subject) => {
    // A server action's argument is whatever a caller posted, and this one reaches the sign-in store.
    if (typeof token !== "string" || token === "") return { success: false, error: VALIDATION_FAILED };
    // The account page's own admission: an address holding a grant deletes only from the session its
    // administrator's lane admits, never one its mailbox made.
    if (subject.subjekt.verwaltung !== null && !subject.admin) return { success: false, error: KONTO_FORBIDDEN };

    // Unconditional: the erasure reaches a squad and a fixture whatever this person turns out to hold.
    invalidatesOnWrite("spieler", "spiele");
    // The token is spent in the sign-in store, written past the API client, whatever the press comes to.
    recordWriteSent();

    // A throw of the erasure, or of the store past it, is the spine's to answer, as every person write's is.
    const outcome = await deleteOwnAccount(token, await headers(), () => eraseEigeneDaten());
    if (outcome === "linkRefused") return { success: false, error: LINK_UNGUELTIG };

    return { success: true, message: "Dein Konto und Deine Angaben sind gelöscht." };
  });
}
