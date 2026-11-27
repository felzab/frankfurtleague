"use server";

import { z } from "zod";

import { action, PAGE_HOLDER } from "@/core/action";
import { accountStandsAt } from "@/core/auth/accounts";
import { endSessionsOfAddress } from "@/core/auth/accountSessions";
import { refusedAs } from "@/core/errors";
import { banListDeleteBanListEntry, banListPostBanListEntry } from "@/core/generated/client/sdk";
import { BanListDeleteBanListEntryParams, BanListPostBanListEntryBody } from "@/core/generated/zod/inputs";
import { SERVER_COPY } from "@/core/serverCopy";
import { SignInPayloadSchema } from "@/features/auth/schemas";

import type { Code } from "@/core/generated/client/types";

/** The refusal saying the list already holds the address. */
const LISTED: ReadonlySet<Code> = new Set<Code>(["duplicate_key"]);

/**
 * The dialog's boxes, by the names they post under. The address is held to the sign-in's own rule, the published one
 * taking an empty box and the rest being the backend's to refuse.
 */
const BanForm = z.object({
  email: SignInPayloadSchema.shape.email,
  ban_reason: BanListPostBanListEntryBody.shape.ban_reason,
  ...PAGE_HOLDER,
});

const LiftInput = z.object({ id: BanListDeleteBanListEntryParams.shape.ban_list_entry_id, ...PAGE_HOLDER });

/**
 * Bans an address from the dialog over the list, behind its dry run and the passkey touch: its next sign-in is refused,
 * its live sessions end here, and an address holding an account is owed its notice in the ban's own transaction. The
 * ban is written before any sign-out, so a sign-in completing after the write is refused as its session is made, and
 * every session begun before it is ended by the same press. A store that cannot say whether an account stands fails
 * the press before the write, and a sign-out failing after it shows the shared failure line over a ban that stands: the
 * administrator is not told which step failed, and the sessions run on until a second press, the address typed again,
 * ends them before its refusal. A second ban is refused with no field, which the dialog's line says. The dry run asks
 * no account and ends no session but those of an address the list already holds, since its refusal is where that
 * second press now stops.
 */
export const enterBan = action({
  lane: "admin",
  passkey: true,
  dryRun: true,
  name: "enterBan",
  input: BanForm,
  boxes: ["email", "ban_reason"],
  run: async ({ email, ban_reason }, { dryRun }) => {
    // Read ahead of the write, so the ban owes its own notice in its own transaction; a store that cannot say throws
    // here, and nothing is written. The dry run judges no notice, so it asks no store.
    const account = !dryRun && (await accountStandsAt(email));

    try {
      await banListPostBanListEntry({ email, ban_reason, notify: account }, { dry_run: dryRun });
    } catch (failed) {
      if (!refusedAs(failed, LISTED)) throw failed;
      // A first press whose answer was lost or whose sign-out failed left the ban standing and its sessions running, and
      // this press is the only one that can still end them, so it ends them every time before it refuses, on the dry
      // run too, whose refusal comes before any touch. Only a banned address's sessions end, and a session of an address
      // banned earlier is already gone, so this costs nobody anything.
      await endSessionsOfAddress(email);
      return { ok: false, errorCode: "duplicate_key", reason: SERVER_COPY.actAnswer.banned };
    }
    if (dryRun) return { ok: true, value: undefined };

    // After the write is acknowledged, so nobody is signed out by a request that then failed.
    await endSessionsOfAddress(email);
    return { ok: true, value: undefined };
  },
});

/**
 * Lifts a ban from its row, behind the passkey touch. A row another administrator lifted first answers 404, which the
 * builder words as the stale page it is.
 */
export const liftBan = action({
  lane: "admin",
  passkey: true,
  name: "liftBan",
  input: LiftInput,
  run: async ({ id }) => {
    await banListDeleteBanListEntry(id);
    return { ok: true, value: undefined };
  },
});
