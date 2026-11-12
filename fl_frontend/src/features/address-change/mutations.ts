import { addressChangeSweepAddressChange } from "@/core/generated/client/sdk";

import type { FLAddressChangeSweepResponse } from "@/core/generated/client/types";

/** A timer holds no session, and a lapsed change or a due one is the clock's. `after` is the previous call's answer. */
export async function postAddressChangeSweep(after: string | null): Promise<FLAddressChangeSweepResponse> {
  // Left out on a pass's first call: the server takes `after` as an id wherever it is present.
  return addressChangeSweepAddressChange(after === null ? {} : { after });
}
