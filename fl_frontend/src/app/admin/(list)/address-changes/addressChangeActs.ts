"use server";

import { z } from "zod";

import { action, besideRefusal, fault, PAGE_HOLDER } from "@/core/action";
import { accountStandsAt } from "@/core/auth/accounts";
import { addressChangePostAddressChangeAdmin, addressChangeResendConfirmation } from "@/core/generated/client/sdk";
import { AddressChangeResendConfirmationParams } from "@/core/generated/zod/inputs";
import { SERVER_COPY } from "@/core/serverCopy";
import { accountAtNewAddress } from "@/features/address-change/account";
import { SignInAddressSchema, SignInPayloadSchema } from "@/features/auth/schemas";

/**
 * A change started for a person who says they cannot sign in: the address on file, and the new one, held as an address
 * the person will sign in at. An account standing at the new address is refused on its box before the mint, which
 * writes: the backend cannot see the sign-in store. Its dry run asks the backend's own dry run as well, so the press
 * before the touch names every fault the two find. The address's running change ends replaced, which the dialog says
 * as the address is typed.
 */
export const startLostMailboxChange = action({
  lane: "admin",
  passkey: true,
  dryRun: true,
  name: "startLostMailboxChange",
  input: z.object({
    address: SignInPayloadSchema.shape.email,
    email: SignInAddressSchema,
    ...PAGE_HOLDER,
  }),
  boxes: ["address", "email"],
  run: async ({ address, email }, { dryRun }) => {
    const taken = (await accountStandsAt(email)) ? [fault("email", "address_change_taken")] : [];
    if (taken.length > 0 && !dryRun) return { ok: false, faults: taken };
    try {
      await addressChangePostAddressChangeAdmin({ address, email }, { dry_run: dryRun });
    } catch (failed) {
      return besideRefusal(taken, failed);
    }
    return taken.length > 0 ? { ok: false, faults: taken } : { ok: true, value: undefined };
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
  input: AddressChangeResendConfirmationParams.extend(PAGE_HOLDER),
  run: async ({ address_change_id }) => {
    if (await accountAtNewAddress({ address_change_id })) {
      return { ok: false, errorCode: "address_change_taken", reason: SERVER_COPY.refusalLine.address_change_taken };
    }
    await addressChangeResendConfirmation(address_change_id);
    return { ok: true, value: undefined };
  },
});
