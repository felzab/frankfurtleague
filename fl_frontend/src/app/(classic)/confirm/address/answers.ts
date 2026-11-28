"use server";

import { redirect } from "next/navigation";

import { z } from "zod";

import { action } from "@/core/action";
import { requestOf } from "@/core/errors";
import { addressChangePostAddressChangeAnswer, addressChangePostAddressChangeStop } from "@/core/generated/client/sdk";
import { AddressChangePostAddressChangeAnswerBody } from "@/core/generated/zod/inputs";
import { logger } from "@/core/logging";
import { forgetMailedLink } from "@/core/mailedLink";
import { ROUTES } from "@/core/routes";
import { accountAtNewAddress } from "@/features/address-change/account";
import { runAddressChangeMoves } from "@/features/address-change/moves";
import { endsTheLink } from "@/features/address-change/refusals";

import { doneAt, LINK_INVALID, STOPPED_AT } from "./ends";

import type { EndState } from "@/kit/MailedPage";

const { token } = AddressChangePostAddressChangeAnswerBody.shape;

/**
 * Either link's question answered, the side and the way the page read posted beside the token, the pressed act under
 * the one-shot form's `act`: the main act confirms, the refusal declines. The two word the end alone; the
 * backend tells the links apart by the token. A link that holds no more at the press, answered, ended or refused since
 * the page opened, ends as the link no longer valid, one message for every cause.
 *
 * Done, the page forgets the link, as the privacy notice says of a mailed link once it is used, and leads on to the
 * done page naming the end: the link's page, rendered again on the forgotten link, would title the tab and a reload as
 * a link no longer valid.
 */
export const answerAddressChange = action({
  lane: "public",
  name: "answerAddressChange",
  input: z.object({
    token,
    side: z.enum(["previous", "new"]),
    way: z.enum(["account", "waiting_period"]),
    act: z.enum(["primary", "secondary"]),
  }),
  exempt: "mailedLink",
  run: async ({ token: link, side, way, act }): Promise<{ ok: true; value: EndState }> => {
    const answer = act === "primary" ? "confirmed" : "declined";
    // The sign-in store is this server's, so the backend's press cannot refuse an account at the new address: refused
    // here, as the backend's own refusals of the address are. A decline is refused nothing. Asked whatever side the form
    // posts, which a holder can edit: the lookup answers only the new mailbox's token, so the address on file's finds none.
    if (answer === "confirmed" && (await accountAtNewAddress({ token: link }))) return { ok: true, value: LINK_INVALID };

    let answered;
    try {
      answered = await addressChangePostAddressChangeAnswer({ token: link, answer });
    } catch (error) {
      if (!endsTheLink(error)) throw error;
      return { ok: true, value: LINK_INVALID };
    }

    if (answered.effective) await carryTheAccount();
    await forgetMailedLink(ROUTES.addressChangeConfirmation.path());
    redirect(doneAt(side, answered.answer, answered.effective_from, way));
  },
});

/** The address on file's stop, which hands nothing over: refused only where the link holds no more. */
export const stopAddressChange = action({
  lane: "public",
  name: "stopAddressChange",
  input: z.object({ token }),
  exempt: "mailedLink",
  run: async ({ token: link }): Promise<{ ok: true; value: EndState }> => {
    try {
      await addressChangePostAddressChangeStop({ token: link });
    } catch (error) {
      if (!endsTheLink(error)) throw error;
      return { ok: true, value: LINK_INVALID };
    }
    await forgetMailedLink(ROUTES.addressChangeConfirmation.path());
    redirect(STOPPED_AT);
  },
});

/**
 * The account carry the effect owed in its own transaction, awaited before the done end, which invites the sign-in at
 * the new address: a sign-in there while the carry is still owed opens a fresh account, which the carry then finds
 * standing, leaving an administrator's passkeys on the old one. Next's `after` is for work no answer waits on, and this
 * answer's next page does. A failure is logged and left to the hourly pass, the effect having committed. No address
 * reaches this action.
 */
async function carryTheAccount(): Promise<void> {
  try {
    await runAddressChangeMoves();
  } catch (failed) {
    // The name alone: a failure in the sign-in store routinely carries the address.
    logger.error("address_change.carry_failed", undefined, { name: failed instanceof Error ? failed.name : "unknown", ...requestOf(failed) });
  }
}
