"use server";

import { z } from "zod";

import { action, PAGE_HOLDER } from "@/core/action";
import { addressChangeDeleteAddressChange } from "@/core/generated/client/sdk";
import { AddressChangeDeleteAddressChangeParams } from "@/core/generated/zod/inputs";

/**
 * Ends the change the row shows and no later one, the address on file staying: Adressänderungen's „Verwerfen“ and
 * Administratoren's withdrawal of a holder's waiting change, which are one endpoint.
 */
export const discardChange = action({
  lane: "admin",
  passkey: true,
  name: "discardChange",
  input: z.object({ id: AddressChangeDeleteAddressChangeParams.shape.address_change_id, ...PAGE_HOLDER }),
  ownWords: ["own_address", "admin_address"],
  run: async ({ id }) => {
    await addressChangeDeleteAddressChange(id);
    return { ok: true, value: undefined };
  },
});
