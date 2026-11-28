"use server";

import { z } from "zod";

import { action, PAGE_HOLDER } from "@/core/action";
import { deletePasskeysAt } from "@/core/auth/passkeys";
import { grantsDeleteGrant, grantsDeleteHandover, grantsPostGrant, grantsPostHandover } from "@/core/generated/client/sdk";
import { logger } from "@/core/logging";
import { SignInAddressSchema } from "@/features/auth/schemas";
import { GRANT_ID } from "@/features/grants/schemas";

const NewGrant = z.object({ email: SignInAddressSchema, ...PAGE_HOLDER });

const OfGrant = z.object({ id: GRANT_ID, ...PAGE_HOLDER });

const HandoverChoice = z.object({ grant_id: GRANT_ID, ...PAGE_HOLDER });

/** The access holds once the wait has passed, every holder and the person told. */
export const addAdministrator = action({
  lane: "admin",
  name: "addAdministrator",
  passkey: true,
  dryRun: true,
  input: NewGrant,
  boxes: ["email"],
  run: async ({ email }, { dryRun }) => {
    await grantsPostGrant({ email }, { dry_run: dryRun });
    return { ok: true, value: undefined };
  },
});

/**
 * Removes an administrator at once, or withdraws an addition still waiting, by the same press, then deletes the
 * address's passkeys and the sessions they made. A failed deletion is logged and still answers done: the grant is
 * gone, so a second press meets no row, and the hourly account sweep deletes the passkeys of an address holding none.
 */
export const removeAdministrator = action({
  lane: "admin",
  name: "removeAdministrator",
  passkey: true,
  input: OfGrant,
  run: async ({ id }) => {
    const { address } = await grantsDeleteGrant(id);
    try {
      await deletePasskeysAt(address);
    } catch (failed) {
      // The name alone: a failure in the sign-in store routinely carries the address.
      logger.error("grants.passkeys_not_deleted", undefined, { name: failed instanceof Error ? failed.name : "unknown" });
    }
    return { ok: true, value: undefined };
  },
});

/** Starts handing the owner role to a current administrator, who holds it once the wait has passed. */
export const startHandover = action({
  lane: "admin",
  name: "startHandover",
  passkey: true,
  dryRun: true,
  input: HandoverChoice,
  run: async ({ grant_id }, { dryRun }) => {
    await grantsPostHandover(grant_id, { dry_run: dryRun });
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
