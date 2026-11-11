"use server";

import { z } from "zod";

import { action, PAGE_HOLDER } from "@/core/action";
import { accountHoldingsAt, deleteAccountFor } from "@/core/auth/accounts";
import { COPY } from "@/core/copy";
import { formatNumber } from "@/core/format";
import { identityGetErasureView, identityPostErasure } from "@/core/generated/client/sdk";
import { IdentityPostErasureBody } from "@/core/generated/zod/inputs";
import { logger } from "@/core/logging";

import type { Copy } from "@/core/copy";
import type { FLErasureViewResponse } from "@/core/generated/client/types";
import type { Fact } from "@/kit/Facts";

const WORDS = COPY.admin.erasure;

/** What the confirmation counts: the league's records, then the account's, which the sign-in store holds. */
type ErasureCounts = FLErasureViewResponse & { account: number; passkeys: number };

/** The rows the confirmation can show, in the order it shows them. */
const COUNTS = [
  [COPY.template.account, "account"],
  [COPY.account.passkeys.title, "passkeys"],
  [COPY.shared.spieler, "spieler"],
  [COPY.shared.schiedsrichter, "schiedsrichter"],
  [WORDS.count.teamSeats, "kontakt_seats"],
  [WORDS.count.bewerbungSeats, "bewerbung_seats"],
  [COPY.page.registrierungen, "registrierungen"],
  [WORDS.count.spiele, "spiele"],
  [WORDS.count.addressChanges, "address_change"],
  [WORDS.count.grant, "grants"],
] as const satisfies ReadonlyArray<readonly [Copy, keyof ErasureCounts]>;

/** Only what is there. */
const factsOf = (counts: ErasureCounts): Fact[] =>
  COUNTS.filter(([, key]) => counts[key] > 0).map(([label, key]) => ({
    label,
    value: { record: formatNumber(counts[key]) },
    figures: true,
  }));

/**
 * What the erasure would reach, as counts and never by name, read at the form's press. It holds the reference to the
 * erasure's own rule too, so a box the erasure would refuse is refused before the question rather than behind it, and
 * hands both boxes back as stripped, which the erasure then sends. An address holding nothing keeps the act: the log's
 * address step still runs.
 */
export const readErasureCounts = action({
  lane: "admin",
  name: "readErasureCounts",
  input: IdentityPostErasureBody,
  ownWords: ["own_address", "admin_address", "email_not_accepted"],
  paths: { email: "email" },
  examples: { email: COPY.shared.field.exampleAddress },
  run: async ({ email, reason }) => {
    const view = await identityGetErasureView({ email });
    // After the view, whose refusal leaves the sign-in store unread.
    const facts = factsOf({ ...view, ...(await accountHoldingsAt(email)) });
    const consequence = facts.length === 0 ? COPY.admin.nothingAtAddress : WORDS.consequence;
    return { ok: true, value: { question: { subject: WORDS.object, consequence, facts }, input: { email, reason } } };
  },
});

/** Whether the address's account is known gone, or was never there; a repeat of the erasure deletes one left standing. */
async function accountCleared(email: string): Promise<boolean> {
  try {
    await deleteAccountFor(email);
    return true;
  } catch (failed) {
    // The NAME alone: a failure in the sign-in store routinely carries the address.
    logger.error("erasure.account_not_deleted", undefined, { name: failed instanceof Error ? failed.name : "unknown" });
    return false;
  }
}

/**
 * Erases every league record of the address, then its sign-in account, for good. The records go first, as an account
 * deleted ahead of a refused erasure leaves a person whose data stands and who cannot sign in to ask again. An account
 * left standing, or left unknown by a failed commit, answers as not done, so the question stays open and its press
 * repeats the erasure, which finds nothing left to erase and reaches the account again.
 */
export const eraseAddress = action({
  lane: "admin",
  name: "eraseAddress",
  passkey: true,
  input: z.object({ ...IdentityPostErasureBody.shape, ...PAGE_HOLDER }),
  ownWords: ["own_address", "admin_address", "foreign_address_change", "email_not_accepted"],
  paths: { email: "email" },
  examples: { email: COPY.shared.field.exampleAddress },
  run: async ({ email, reason }) => {
    await identityPostErasure({ email, reason });
    if (await accountCleared(email)) return { ok: true, value: undefined, note: COPY.admin.erased };
    return { ok: false, reason: WORDS.partial, warn: true };
  },
});
