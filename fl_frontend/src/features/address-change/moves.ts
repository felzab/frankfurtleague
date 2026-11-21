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
 * of the account's, which stood at the old address then.
 */
export async function runAddressChangeMoves(): Promise<void> {
  for (;;) {
    const { moves } = await addressChangeGetAddressChangeMoves();
    if (moves.length === 0) return;

    for (const { old: oldAddress, new: newAddress } of moves) {
      // Read before the carry, so an unread grant rejects with nothing moved rather than keep the passkeys.
      const { admin_tier: grant } = await lookUpSignIn(asSignInIdentifier(newAddress));
      const carry = await carryAccount(oldAddress, newAddress);
      // The new address holding its own account, opened since every press refused one there: it signs in to that one.
      if (carry === "taken") logger.warn("address_change.account_not_moved", { reason: "occupied" });
      if (carry === "moved" && grant === null) await deletePasskeysAt(newAddress);
    }
    await addressChangePostAddressChangeMovesDone({ ids: moves.map(({ id }) => id) });
  }
}
