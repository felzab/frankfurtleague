"use server";

import { headers } from "next/headers";

import { isAPIError } from "better-auth/api";

import { notifyPasskeyRemoved, PASSKEY_LIMIT, passkeysOf, removePasskey, renamePasskey } from "@/core/auth";
import { recordWriteSent } from "@/core/requestScope";
import { stepUpRequired } from "@/shared/utils/adminMutation";
import { enrolmentUntil, runKontoMutation } from "@/shared/utils/kontoMutation";
import { buildRefusal, LADE_DIE_SEITE_NEU } from "@/shared/utils/refusal";
import { toFieldErrors, VALIDATION_FAILED } from "@/shared/utils/validation";

import { PasskeyNamePayloadSchema } from "./schemas";

import type { ActionResult, QueryResult } from "@/shared/types/types";

/* `disabledPaths` closes the plugin's management endpoints to HTTP alone, so these actions, each
   calling in process, are the whole of the surface (`docs/frontend/spec.md :: I198`). */

/**
 * What protects an administrator's last ROW; a person may remove theirs and signs in by code again.
 * The card closes its own control with the same sentence
 * (`fl_frontend/src/features/passkeys/components/ui/PasskeyKarteView.tsx :: LETZTER_PASSKEY`): **move both.**
 */
const LETZTER_PASSKEY = "Der letzte Passkey lässt sich nicht löschen.";

/**
 * A change that met another to the holder's passkeys or sessions (`docs/frontend/spec.md :: I312`), or
 * addressed a row another change took away or that was never the holder's: a stale list either way.
 */
const GLEICHZEITIG_GEAENDERT = buildRefusal({
  reason: "Gleichzeitig wurde an Deinen Passkeys oder Anmeldungen etwas geändert",
  repair: LADE_DIE_SEITE_NEU,
});

/** `diesesGeraet` says the removal ended the session the request came with, which the page then leaves. */
export async function removePasskeyAction(id: string): Promise<ActionResult<{ diesesGeraet: boolean }>> {
  return runKontoMutation("removePasskeyAction", async (served) => {
    // A server action's argument is whatever a caller posted, and this one reaches a store query.
    if (typeof id !== "string" || id === "") return { success: false, error: VALIDATION_FAILED };

    const held = await passkeysOf(served.user.id);
    // Read before the removal, which may end the session this request arrived with.
    const diesesGeraet = held.some((row) => row.id === id && row.credentialID === served.session.passkeyCredentialId);

    // Named here because the sign-in store is written past the API client, which records its own writes: unrecorded,
    // the spine answers a success unrefreshed and a throw after the commit as a plain failure.
    recordWriteSent();

    const removal = await removePasskey({ id: served.user.id, verwaltung: served.verwaltung }, id);

    if (removal === "last") return { success: false, error: LETZTER_PASSKEY };
    if (removal === "absent" || removal === "conflict") return { success: false, error: GLEICHZEITIG_GEAENDERT };

    await notifyPasskeyRemoved(served.user.email);

    return { success: true, message: "Passkey gelöscht", diesesGeraet: diesesGeraet };
  });
}

/** The name the card shows; the plugin checks the row is the caller's own and the length is this slice's. */
export async function renamePasskeyAction(id: string, name: string): Promise<ActionResult> {
  return runKontoMutation("renamePasskeyAction", async () => {
    const parsed = PasskeyNamePayloadSchema.safeParse({ name: name });
    if (typeof id !== "string" || id === "") return { success: false, error: VALIDATION_FAILED };
    if (!parsed.success) return { success: false, error: VALIDATION_FAILED, fieldErrors: toFieldErrors(parsed.error) };

    recordWriteSent();

    try {
      await renamePasskey(id, parsed.data.name, await headers());
    } catch (failed) {
      // The plugin refuses a row that is gone and a row that is another person's alike, both before it
      // writes: to the holder either is a stale list.
      if (isAPIError(failed) && failed.statusCode < 500) return { success: false, error: GLEICHZEITIG_GEAENDERT };
      throw failed;
    }

    return { success: true, message: "Passkey umbenannt" };
  });
}

/**
 * Read after the enrolment guard's 404, which answers the cap, a stale sign-in and a held authenticator
 * alike: the step-up refusal, by the enrolment's own window, names the second, the count the first
 * (`docs/frontend/spec.md :: I427`).
 */
export async function readPasskeyStandAction(): Promise<QueryResult<{ kannHinzufuegen: boolean }>> {
  return runKontoMutation("readPasskeyStandAction", async (served) => {
    if (enrolmentUntil(served) === null) return stepUpRequired();

    const held = await passkeysOf(served.user.id);

    return { success: true, kannHinzufuegen: held.length < PASSKEY_LIMIT };
  });
}
