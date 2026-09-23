"use server";

import { refresh } from "next/cache";
import { headers } from "next/headers";

import { getAuthenticatorName } from "@better-auth/passkey";

import { auth, getAdminSession, isRecentlyAsserted, notifyPasskeyRemoved, PASSKEY_LIMIT, removePasskey } from "@/core/auth";
import { ADMIN_FORBIDDEN, runAdminMutation } from "@/shared/utils/adminMutation";
import { buildRefusal } from "@/shared/utils/refusal";
import { VALIDATION_FAILED } from "@/shared/utils/validation";

import type { ActionResult, QueryResult } from "@/shared/types/types";
import type { PasskeyEintrag } from "./types";

/* `disabledPaths` closes the plugin's management endpoints to HTTP alone, so these two actions are
   the whole of the surface (`docs/frontend/spec.md :: I198`); a removal is judged against the rows
   the list's own session middleware answers. */

/**
 * The step-up the dialog re-runs the assertion for, worded for a reader whose window ran out between
 * the ceremony and the press (`docs/frontend/spec.md :: I312`).
 */
const BESTAETIGUNG_ABGELAUFEN = "Die Bestätigung mit dem Passkey ist abgelaufen. Versuche es noch einmal.";

/**
 * What protects the last ROW; what protects this administrator's own authenticator is the step-up.
 * The dialog closes its own control with the same sentence
 * (`fl_frontend/src/features/passkeys/components/modals/PasskeyModal.tsx :: LETZTER_PASSKEY`):
 * **move both.**
 */
const LETZTER_PASSKEY = "Der letzte Passkey lässt sich nicht löschen.";

/** A removal that met a change to this administrator's passkeys or sessions (`docs/frontend/spec.md :: I312`). */
const GLEICHZEITIG_GEAENDERT = buildRefusal({
  reason: "Gleichzeitig wurde an Deinen Passkeys oder Anmeldungen etwas geändert",
  repair: "Lade die Seite neu",
});

export async function readPasskeysAction(): Promise<QueryResult<{ passkeys: PasskeyEintrag[]; kannHinzufuegen: boolean }>> {
  return runAdminMutation("readPasskeysAction", { readOnly: true }, async () => {
    if (!(await getAdminSession())) {
      return { success: false, error: ADMIN_FORBIDDEN };
    }

    const held = await auth.api.listPasskeys({ headers: await headers() });

    return {
      success: true,
      // Projected rather than handed over: `listPasskeys` answers the whole row, the public key and
      // the credential id among its fields, and the dialog draws none of them.
      passkeys: held.map((row) => ({
        id: row.id,
        createdAt: new Date(row.createdAt).toISOString(),
        label: getAuthenticatorName(row.aaguid) ?? null,
      })),
      // The cap is judged again at the enrolment itself; this is what closes the control so the
      // reader meets a sentence rather than a refused browser prompt.
      kannHinzufuegen: held.length < PASSKEY_LIMIT,
    };
  });
}

export async function removePasskeyAction(id: string): Promise<ActionResult> {
  return runAdminMutation("removePasskeyAction", { readOnly: false }, async () => {
    if (!(await getAdminSession())) {
      return { success: false, error: ADMIN_FORBIDDEN };
    }

    // Resolved a second time rather than kept from the line above, which
    // `fl_frontend/src/core/adminSessionGuard.test.ts` sweeps for as the literal opener it is.
    const served = await getAdminSession();
    if (!served) {
      return { success: false, error: ADMIN_FORBIDDEN };
    }

    // A server action's argument is whatever a caller posted, and this one reaches a store query.
    if (typeof id !== "string" || id === "") {
      return { success: false, error: VALIDATION_FAILED };
    }

    // A cookie alone may not remove: the dialog re-runs the assertion ceremony first, which mints a
    // session whose `createdAt` is now and which an authenticator this account never enrolled cannot.
    if (!isRecentlyAsserted(served.session.createdAt)) {
      return { success: false, error: BESTAETIGUNG_ABGELAUFEN };
    }

    const requestHeaders = await headers();
    const held = await auth.api.listPasskeys({ headers: requestHeaders });

    // Read off the caller's own rows, which is all `listPasskeys` answers: at zero rows the mailed
    // link enrols again, so the administrator is locked out of nothing, but the page offers it to
    // nobody either.
    const [own] = held;
    if (own === undefined || held.length <= 1) {
      return { success: false, error: LETZTER_PASSKEY };
    }

    // The rows above are the caller's own, so their `userId` is the account the removal is judged on
    // again, inside the transaction that deletes and signs the other devices out.
    const removal = await removePasskey(own.userId, id, served.session.id);

    if (removal === "last") return { success: false, error: LETZTER_PASSKEY };

    // A row that is gone, or another person's: both read to this administrator as a list they are
    // holding a stale copy of.
    if (removal === "absent") {
      return { success: false, error: buildRefusal({ reason: "Der Passkey wurde nicht gelöscht", repair: "Lade die Seite neu" }) };
    }

    if (removal === "conflict") return { success: false, error: GLEICHZEITIG_GEAENDERT };

    await notifyPasskeyRemoved(served.user.email);

    refresh();

    return { success: true, message: "Passkey gelöscht" };
  });
}
