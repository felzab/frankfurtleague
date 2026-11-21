import "server-only";

import { carryAccount } from "@/core/auth/accounts";
import { deletePasskeysAt } from "@/core/auth/passkeys";
import { asSignInIdentifier } from "@/core/emailAddress";
import { addressChangeGetAddressChangeMoves, addressChangePostAddressChangeMovesDone } from "@/core/generated/client/sdk";
import { logger } from "@/core/logging";
import { lookUpSignIn } from "@/core/signInGate";

/**
 * A carry moves the account once, so a second run, the hourly pass's for an answer a confirmation lost, finds none to
 * move; a failure rejects, the rest waiting for the next run. An account landing at an address holding no grant
 * brings no passkey across: only an administrator holds one, and a grant removed while the carry waited deleted none
 * of the account's, which stood at the old address then. The deletion runs whatever the carry answered, so a retry
 * deletes what an earlier run carried before it failed.
 */
export async function runAddressChangeMoves(): Promise<void> {
  for (;;) {
    const { moves } = await addressChangeGetAddressChangeMoves();
    if (moves.length === 0) return;

    for (const { old: oldAddress, new: newAddress } of moves) {
      // Read before the carry, so a grant that cannot be read rejects the run with nothing of this move made.
      const { admin_tier: grant } = await lookUpSignIn(asSignInIdentifier(newAddress));
      const carry = await carryAccount(oldAddress, newAddress);
      // The new address holding its own account, opened since every press refused one there: it signs in to that one.
      if (carry === "taken") logger.warn("address_change.account_not_moved", { reason: "occupied" });
      // No address holding no grant keeps a passkey: on `"none"` this deletes what an earlier run carried, and an
      // account opened at the new address itself (`"taken"`) could enrol none there.
      if (grant === null) await deletePasskeysAt(newAddress);
    }
    await addressChangePostAddressChangeMovesDone({ ids: moves.map(({ id }) => id) });
  }
}
