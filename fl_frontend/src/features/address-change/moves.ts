import "server-only";

import { carryAccount } from "@/core/auth/accounts";
import { addressChangeGetAddressChangeMoves, addressChangePostAddressChangeMovesDone } from "@/core/generated/client/sdk";
import { logger } from "@/core/logging";

/**
 * A carry moves the account once, so a second run, the hourly pass's for an answer a confirmation lost, finds none to
 * move; a failure rejects, the rest waiting for the next run. The passkeys of an account landing at an address holding
 * no grant are the account sweep's, which deletes those of every such address.
 */
export async function runAddressChangeMoves(): Promise<void> {
  for (;;) {
    const { moves } = await addressChangeGetAddressChangeMoves();
    if (moves.length === 0) return;

    for (const { old: oldAddress, new: newAddress } of moves) {
      const carry = await carryAccount(oldAddress, newAddress);
      // The new address holding its own account, opened since every press refused one there: it signs in to that one.
      if (carry === "taken") logger.warn("address_change.account_not_moved", { reason: "occupied" });
    }
    await addressChangePostAddressChangeMovesDone({ ids: moves.map(({ id }) => id) });
  }
}
