"use server";

import { z } from "zod";

import { action, PAGE_HOLDER } from "@/core/action";
import { accountStandsAt } from "@/core/auth/accounts";
import { COPY } from "@/core/copy";
import { addressChangeInviteAddressChange, addressChangePostAddressChangeAdmin } from "@/core/generated/client/sdk";
import { AddressChangeInviteAddressChangeParams, AddressChangePostAddressChangeAdminBody } from "@/core/generated/zod/inputs";
import { SERVER_COPY } from "@/core/serverCopy";
import { accountAtNewAddress } from "@/features/address-change/account";
import { SignInAddressSchema, SignInPayloadSchema } from "@/features/auth/schemas";

/**
 * A change started for a person who says they cannot sign in: the address on file, the new one, held as an address the
 * person will sign in at, and the reason. An account standing at the new address is refused before the mint, which writes: the backend cannot see the sign-in store. The address's running change ends
 * replaced, which the dialog says as the address is typed.
 */
export const startLostMailboxChange = action({
  lane: "admin",
  passkey: true,
  name: "startLostMailboxChange",
  input: z.object({
    address: SignInPayloadSchema.shape.email,
    email: SignInAddressSchema,
    change_reason: AddressChangePostAddressChangeAdminBody.shape.change_reason,
    ...PAGE_HOLDER,
  }),
  ownWords: [
    "own_address",
    "admin_address",
    "address_change_nothing",
    "address_change_taken",
    "address_change_occupied",
    "address_change_unchanged",
    "email_not_accepted",
    "address_in_free_text",
  ],
  paths: { address: "address", email: "email", change_reason: "change_reason" },
  examples: { address: COPY.shared.field.exampleAddress, email: COPY.shared.field.exampleAddress },
  run: async ({ address, email, change_reason }) => {
    if (await accountStandsAt(email)) return { ok: false, fieldErrors: { email: COPY.shared.field.taken } };
    await addressChangePostAddressChangeAdmin({ address, email, change_reason });
    return { ok: true, value: undefined };
  },
});

/**
 * A fresh link to the change the row shows, and to no later one: the earlier link is dead either way, and the address on
 * file is mailed nothing again. Refused before the re-mint, which kills the earlier link, where an account has come to
 * stand at the new address: a fresh link would be refused at its press.
 */
export const resendChangeLink = action({
  lane: "admin",
  passkey: true,
  name: "resendChangeLink",
  input: AddressChangeInviteAddressChangeParams.extend(PAGE_HOLDER),
  ownWords: ["own_address", "admin_address", "address_change_new_taken"],
  run: async ({ address_change_id }) => {
    if (await accountAtNewAddress({ address_change_id })) {
      return { ok: false, errorCode: "address_change_new_taken", reason: SERVER_COPY.refusalLine.address_change_new_taken };
    }
    await addressChangeInviteAddressChange(address_change_id);
    return { ok: true, value: undefined };
  },
});
