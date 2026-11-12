import { accountStandsAt } from "@/core/auth/accounts";
import { addressChangeGetAddressChangeAddress } from "@/core/generated/client/sdk";

import type { FLAddressChangeAddressPayload } from "@/core/generated/client/types";

/**
 * Whether a sign-in account already stands at the new address of the live change the key names, which refuses the
 * change. The address stays inside this call: no caller, page or log line is handed it.
 */
export async function accountAtNewAddress(key: FLAddressChangeAddressPayload): Promise<boolean> {
  const { email } = await addressChangeGetAddressChangeAddress(key);
  return email !== null && (await accountStandsAt(email));
}
