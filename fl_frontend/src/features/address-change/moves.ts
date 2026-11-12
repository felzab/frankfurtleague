import "server-only";

import { carryAccount } from "@/core/auth/accounts";
import { logger } from "@/core/logging";

import { getAddressChangeMoves, postAddressChangeMovesDone } from "./mutations";

/**
 * A carry moves the account once, so a second run, the hourly pass's for an answer a confirmation lost, finds none to
 * move; a failure rejects, the rest waiting for the next run.
 */
export async function runAddressChangeMoves(): Promise<void> {
  for (;;) {
    const { moves } = await getAddressChangeMoves();
    if (moves.length === 0) return;

    for (const { old: oldAddress, new: newAddress } of moves) {
      // The new address holding its own account, opened since every press refused one there: it signs in to that one.
      if ((await carryAccount(oldAddress, newAddress)) === "taken") logger.warn("address_change.account_not_moved", { reason: "occupied" });
    }
    await postAddressChangeMovesDone({ ids: moves.map(({ id }) => id) });
  }
}
