"use server";

import { z } from "zod";

import { action, PAGE_HOLDER } from "@/core/action";
import { accountStandsAt } from "@/core/auth/accounts";
import { endSessionsOfAddress } from "@/core/auth/accountSessions";
import { COPY } from "@/core/copy";
import { APIBadStatusError } from "@/core/errors";
import { banListDeleteBanListEntry, banListPostBanListEntry } from "@/core/generated/client/sdk";
import { BanListDeleteBanListEntryParams, BanListPostBanListEntryBody } from "@/core/generated/zod/inputs";
import { logger } from "@/core/logging";
import { SERVER_COPY } from "@/core/serverCopy";
import { SignInPayloadSchema } from "@/features/auth/schemas";

import type { Copy } from "@/core/copy";

const PARTIAL = COPY.admin.banList.partial;

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

/** The failure's NAME alone: the address must reach no line. */
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

/** What did not follow a ban that stands; `undefined` where everything did. */
function partialOutcome(sessionsEnded: boolean, noticeOwed: boolean): Copy | undefined {
  if (sessionsEnded) return noticeOwed ? undefined : PARTIAL.notice;
  return noticeOwed ? PARTIAL.sessions : PARTIAL.both;
}

/**
 * Bans an address from the dialog over the list, behind the passkey touch: its next sign-in is refused, its live
 * sessions end here, and an address holding an account is owed its notice in the ban's own transaction. Nothing that
 * fails after the write undoes the ban, so the dialog stays open on what did not follow. A second ban is the unique
 * index's refusal, which the shared 409 answers with no field, and the address is the one box it can be about.
 */
export const enterBan = action({
  lane: "admin",
  passkey: true,
  name: "enterBan",
  input: BanForm,
  ownWords: ["ban_list_admin", "ban_list_no_saison", "email_not_accepted", "address_in_free_text"],
  paths: { email: "email", ban_reason: "ban_reason" },
  examples: { email: COPY.shared.field.exampleAddress },
  run: async ({ email, ban_reason }) => {
    // Read ahead of the write, so the ban owes its own notice in its own transaction.
    const account = await accountAt(email);

    try {
      await banListPostBanListEntry({ email, ban_reason, notify: account === true });
    } catch (failed) {
      if (!(failed instanceof APIBadStatusError) || failed.serverErrorCode !== "duplicate_key") throw failed;
      return { ok: false, errorCode: "duplicate_key", fieldErrors: { email: SERVER_COPY.refusal.duplicate_key } };
    }

    // After the write is acknowledged, so nobody is signed out by a request that then failed.
    const note = partialOutcome(await sessionsEndedAt(email), account !== null);
    return note === undefined ? { ok: true, value: undefined } : { ok: true, value: undefined, note, warn: true };
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
