import "server-only";

import { addressChangeSweepAddressChange } from "@/core/generated/client/sdk";

import { runAddressChangeMoves } from "./moves";

/**
 * Every pending change whose step lapsed, and every one whose waiting time ended, then every account's carry still
 * owed. A timer holds no session, and a lapsed change or a due one is the clock's. A failure rejects, for the heartbeat
 * to name; the pass resolves to what it did, `open` the changes it could not end.
 */
export async function runAddressChangeSweep() {
  const answer = await addressChangeSweepAddressChange();

  // An effect of this pass, or one whose press lost its answer, owes its account's carry.
  await runAddressChangeMoves();

  return {
    count: {
      address_change_removed: answer.removed,
      address_change_effective: answer.effective,
      address_change_discarded: answer.discarded,
      address_change_failed: answer.failed,
    },
    open: answer.failed,
  };
}
