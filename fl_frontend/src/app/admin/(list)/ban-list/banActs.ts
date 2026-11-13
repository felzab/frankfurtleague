"use server";

import { z } from "zod";

import { action, PAGE_HOLDER } from "@/core/action";
import { accountStandsAt } from "@/core/auth/accounts";
import { endSessionsOfAddress, sessionsStandAt } from "@/core/auth/accountSessions";
import { COPY } from "@/core/copy";
import { APIBadStatusError } from "@/core/errors";
import { banListDeleteBanListEntry, banListPostBanListEntry } from "@/core/generated/client/sdk";
import { BanListDeleteBanListEntryParams, BanListPostBanListEntryBody } from "@/core/generated/zod/inputs";
import { logger } from "@/core/logging";
import { SERVER_COPY } from "@/core/serverCopy";
import { SignInPayloadSchema } from "@/features/auth/schemas";

import type { Copy } from "@/core/copy";

const PARTIAL = COPY.admin.banList.partial;
const CLOSED = SERVER_COPY.closedDialog;

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

/** The failure's name alone: the address must reach no line. */
const nameOf = (failed: unknown) => (failed instanceof Error ? failed.name : "unknown");

/**
 * Whether an account stands at the address, which alone is told of its ban: `null` where the store did not say, and
 * nobody is then told, the notice's account sentences being a guess.
 */
async function accountAt(address: string): Promise<boolean | null> {
  try {
    return await accountStandsAt(address);
  } catch (failed) {
    logger.error("ban_list.account_unread", undefined, { name: nameOf(failed) });
    return null;
  }
}

/** Ends the address's live sessions, which the refusal of every next sign-in does not reach. A failure leaves the ban standing. */
async function sessionsEndedAt(address: string): Promise<boolean> {
  try {
    await endSessionsOfAddress(address);
    return true;
  } catch (failed) {
    logger.error("ban_list.sessions_not_ended", undefined, { name: nameOf(failed) });
    return false;
  }
}

/** Whether a second ban has sessions to end; where the store did not say, the ending itself finds that out. */
async function sessionsRunAt(address: string): Promise<boolean> {
  try {
    return await sessionsStandAt(address);
  } catch (failed) {
    logger.error("ban_list.sessions_unread", undefined, { name: nameOf(failed) });
    return false;
  }
}

/** What did not follow a ban that stands; `undefined` where everything did. */
function partialOutcome(sessionsEnded: boolean, noticeOwed: boolean): Copy | undefined {
  if (sessionsEnded) return noticeOwed ? undefined : PARTIAL.notice;
  return noticeOwed ? PARTIAL.sessions : PARTIAL.both;
}

/**
 * Bans an address from the dialog over the list, behind the passkey touch: its next sign-in is refused, its live
 * sessions end here, and an address holding an account is owed its notice in the ban's own transaction. Nothing that
 * fails after the write undoes the ban, so the toast after the dialog closed says what did not follow, in the warn tone,
 * and a second press, the address typed again, can still end the sessions. A second ban is the unique index's refusal,
 * which the shared 409 answers with no field; its sessions end all the same, and a press that ended some says so rather
 * than refusing. The dialog has closed before any answer, so every refusal is a sentence (`boxless`).
 */
export const enterBan = action({
  lane: "admin",
  passkey: true,
  name: "enterBan",
  input: BanForm,
  ownWords: ["ban_list_admin", "ban_list_no_saison", "email_not_accepted", "address_in_free_text"],
  paths: { email: "email", ban_reason: "ban_reason" },
  examples: { email: COPY.shared.field.exampleAddress },
  boxless: {
    email: { value: CLOSED.format.address, email_not_accepted: CLOSED.format.address },
    ban_reason: { required: CLOSED.reasonMissing, address_in_free_text: CLOSED.reasonWithAddress },
  },
  run: async ({ email, ban_reason }) => {
    // Read ahead of the write, so the ban owes its own notice in its own transaction.
    const account = await accountAt(email);

    try {
      await banListPostBanListEntry({ email, ban_reason, notify: account === true });
    } catch (failed) {
      if (!(failed instanceof APIBadStatusError) || failed.serverErrorCode !== "duplicate_key") throw failed;
      // A first press whose answer was lost or whose sign-out failed left the ban standing and its sessions running, and
      // this press is the only one that can still end them. A session of an address banned earlier is already gone, so this
      // costs nobody anything, and finding one is what tells this press from a true second ban.
      const stood = await sessionsRunAt(email);
      if (!(await sessionsEndedAt(email))) return { ok: false, reason: PARTIAL.sessions, warn: true };
      if (stood) return { ok: true, value: undefined, note: PARTIAL.ended };
      return { ok: false, errorCode: "duplicate_key", reason: CLOSED.banned };
    }

    // After the write is acknowledged, so nobody is signed out by a request that then failed.
    const ended = await sessionsEndedAt(email);
    const note = partialOutcome(ended, account !== null);
    if (note === undefined) return { ok: true, value: undefined };
    // Marked as an erasure's partial is, so its toast reads in the warn tone; no press sends a notice the first left.
    return ended ? { ok: true, value: undefined, note, warn: true } : { ok: false, reason: note, warn: true };
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
