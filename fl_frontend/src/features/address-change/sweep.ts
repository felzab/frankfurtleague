import "server-only";

import { addressChangeSweepAddressChange } from "@/core/generated/client/sdk";

import { runAddressChangeMoves } from "./moves";

import type { FLAddressChangeSweepResponse } from "@/core/generated/client/types";

/**
 * Every pending change whose step lapsed, and every one whose waiting time ended, then every account's carry still
 * owed. A timer holds no session, and a lapsed change or a due one is the clock's. A failure rejects, for the heartbeat
 * to name; the pass resolves to what it did, `failed` the changes it could not end.
 */
export async function sweepAddressChange(): Promise<FLAddressChangeSweepResponse> {
  const answer = await addressChangeSweepAddressChange();

  // An effect of this pass, or one whose press lost its answer, owes its account's carry.
  await runAddressChangeMoves();

  return answer;
}
