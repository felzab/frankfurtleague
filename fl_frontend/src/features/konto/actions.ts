"use server";

import { headers } from "next/headers";

import { auth } from "@/core/auth";
import { recordWriteSent } from "@/core/requestScope";
import { isHeldBy, runKontoMutation } from "@/shared/utils/kontoMutation";
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

    const { adapter } = await auth.$context;
    // Named here because the sign-in store is written past the API client, which records its own writes.
    recordWriteSent();

    const ended = await adapter.deleteMany({
      model: "session",
      where: [
        { field: "id", value: id },
        { field: "userId", value: served.user.id },
      ],
    });

    if (ended === 0) return { success: false, error: SCHON_BEENDET };

    return { success: true, message: "Abgemeldet" };
  });
}

/** Ends every sign-in of the holder's but this device's, through the library's own in-process call. */
export async function endAndereAnmeldungenAction(): Promise<ActionResult> {
  return runKontoMutation("endAndereAnmeldungenAction", async () => {
    recordWriteSent();
    await auth.api.revokeOtherSessions({ headers: await headers() });

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
