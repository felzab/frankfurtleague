"use server";

import { refresh } from "next/cache";
import { headers } from "next/headers";

import { isAPIError } from "better-auth/api";
import { z } from "zod";

import { action, PAGE_HOLDER } from "@/core/action";
import { afterTheResponse } from "@/core/afterResponse";
import { notifyPasskeyRemoved } from "@/core/auth/mails";
import { passkeysOf, removePasskey, renamePasskey } from "@/core/auth/passkeys";
import { COPY } from "@/core/copy";
import { RolledBackError } from "@/core/errors";
import { logger } from "@/core/logging";

import { PasskeyNameSchema } from "./schemas";

/* `disabledPaths` closes the plugin's management endpoints to HTTP alone, so these actions, each calling in process,
   are the whole of the surface. */

/** A stored passkey row's id, as the library mints it. */
const PasskeyId = z.string().min(1).max(64);

/** What a removal ended: this device's session, which the page then leaves, or other devices' alone. */
type Removed = "thisDevice" | "otherDevices";

/**
 * Removes one of the person's passkeys, the passkey touch first, and every session it signed in with, the one this
 * request arrived with among them where the touch answered with this passkey: a session the removed passkey made is
 * no session of a passkey the account holds. Where that ended this device's own session the body records no write
 * and renders nothing again, since the page would render under a session that is gone: the page leaves by a document
 * load. Otherwise it reads the page again itself, the sign-in store holding what changed. The notice mail is owed
 * behind the response, so its write counts as none of this action's.
 */
export const removePasskeyAction = action({
  lane: "person",
  claim: "account",
  passkey: true,
  name: "removePasskeyAction",
  input: z.object({ id: PasskeyId, ...PAGE_HOLDER }),
  run: async ({ id }, { served }) => {
    // Read before the removal, which may end the session this request arrived with.
    const thisDevice = (await passkeysOf(served.user.id)).some(
      (row) => row.id === id && row.credentialID === served.session.passkeyCredentialId,
    );
    let removal: Awaited<ReturnType<typeof removePasskey>>;
    try {
      removal = await removePasskey({ id: served.user.id, isAdmin: served.isAdmin }, id);
    } catch (failed) {
      // A rollback removed nothing, so the shared failure line stands and a press again is safe.
      if (failed instanceof RolledBackError) throw failed;
      // Any other failure may be the commit's, landed or not: a reload shows which. Nothing renders again, since the
      // removal may have ended the session this page would render under.
      logger.error("passkeys.removal_outcome_unknown", undefined, { name: failed instanceof Error ? failed.name : "unknown" });
      return { ok: false, reason: COPY.shared.failure.stale };
    }
    if (removal === "last") return { ok: false, reason: COPY.account.passkeys.lastKept };
    if (removal === "absent") return { ok: false, reason: COPY.shared.failure.stale };

    const { email } = served.user;
    afterTheResponse(() => notifyPasskeyRemoved(email));
    if (thisDevice) return { ok: true, value: "thisDevice" satisfies Removed };
    refresh();
    return { ok: true, value: "otherDevices" satisfies Removed };
  },
});

/**
 * The name a passkey's row shows; the plugin checks the row is the caller's own before it writes. Off the touch's
 * fixed list, which names the acts handing access over: a name changes none.
 */
export const renamePasskeyAction = action({
  lane: "person",
  claim: "account",
  name: "renamePasskeyAction",
  input: z.object({ id: PasskeyId, name: PasskeyNameSchema, ...PAGE_HOLDER }),
  run: async ({ id, name }) => {
    try {
      await renamePasskey(id, name, await headers());
    } catch (failed) {
      // A row gone and a row another person's alike, both refused before the plugin writes: to the holder a stale list.
      if (isAPIError(failed) && failed.statusCode < 500) return { ok: false, reason: COPY.shared.failure.stale };
      throw failed;
    }
    refresh();
    return { ok: true, value: undefined };
  },
});
