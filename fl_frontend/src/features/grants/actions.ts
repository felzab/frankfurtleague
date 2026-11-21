"use server";

import { z } from "zod";

import { action, PAGE_HOLDER } from "@/core/action";
import { deletePasskeysAt } from "@/core/auth/passkeys";
import { ADMIN_COPY } from "@/core/copy/admin";
import { grantsDeleteGrant, grantsDeleteHandover, grantsPostGrant, grantsPostHandover } from "@/core/generated/client/sdk";
import { logger } from "@/core/logging";
import { SERVER_COPY } from "@/core/serverCopy";
import { SignInAddressSchema } from "@/features/auth/schemas";

import { GRANT_ID } from "./schemas";

const ADDRESS_FORMAT = SERVER_COPY.closedDialog.format.address;

const NewGrant = z.object({ email: SignInAddressSchema, ...PAGE_HOLDER });

const OfGrant = z.object({ id: GRANT_ID, ...PAGE_HOLDER });

const HandoverChoice = z.object({ grant_id: GRANT_ID, ...PAGE_HOLDER });

/** The access holds once the wait has passed, every holder and the person told. */
export const addAdministrator = action({
  lane: "admin",
  name: "addAdministrator",
  passkey: true,
  input: NewGrant,
  // The dialog has closed before any answer, which its toast says: every refusal is a sentence, never a box's phrase.
  boxless: { email: { value: ADDRESS_FORMAT, email_not_accepted: ADDRESS_FORMAT } },
  run: async ({ email }) => {
    await grantsPostGrant({ email });
    return { ok: true, value: undefined };
  },
});

/** Whether the address's passkeys and the sessions they made are known gone, or were never there. */
async function passkeysCleared(address: string): Promise<boolean> {
  try {
    await deletePasskeysAt(address);
    return true;
  } catch (failed) {
    // The name alone: a failure in the sign-in store routinely carries the address.
    logger.error("grants.passkeys_not_deleted", undefined, { name: failed instanceof Error ? failed.name : "unknown" });
    return false;
  }
}

/**
 * Removes an administrator at once, or withdraws an addition still waiting, by the same press, then deletes the
 * address's passkeys and the sessions they made. Passkeys left standing answer as done in part: the grant is gone, so
 * a second press meets no row.
 */
export const removeAdministrator = action({
  lane: "admin",
  name: "removeAdministrator",
  passkey: true,
  input: OfGrant,
  run: async ({ id }) => {
    const { address } = await grantsDeleteGrant(id);
    if (await passkeysCleared(address)) return { ok: true, value: undefined };
    return { ok: true, value: undefined, note: ADMIN_COPY.administrators.partial, warn: true };
  },
});

/** Starts handing the owner role to a current administrator, who holds it once the wait has passed. */
export const startHandover = action({
  lane: "admin",
  name: "startHandover",
  passkey: true,
  input: HandoverChoice,
  // Its one choice is the page's own list, so nothing a person picks is refused on it, and its dialog has closed.
  boxless: {},
  run: async ({ grant_id }) => {
    await grantsPostHandover(grant_id);
    return { ok: true, value: undefined };
  },
});

export const stopHandover = action({
  lane: "admin",
  name: "stopHandover",
  passkey: true,
  input: OfGrant,
  run: async ({ id }) => {
    await grantsDeleteHandover(id);
    return { ok: true, value: undefined };
  },
});
