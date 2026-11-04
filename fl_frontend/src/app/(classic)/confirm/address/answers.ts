"use server";

import { z } from "zod";

import { action } from "@/core/action";
import { afterTheResponse } from "@/core/afterResponse";
import { COPY } from "@/core/copy";
import { requestOf } from "@/core/errors";
import { AddressChangePostAddressChangeAnswerBody } from "@/core/generated/zod/inputs";
import { logger } from "@/core/logging";
import { kontoAnNeuerAdresse } from "@/features/adresswechsel/konto";
import { ansichtOf } from "@/features/adresswechsel/link";
import { postAdresswechselAnsicht, postAdresswechselAntwort, postAdresswechselStopp } from "@/features/adresswechsel/mutations";
import { mapAdresswechselPresseRefusal } from "@/features/adresswechsel/refusals";
import { runAdresswechselUmzuege } from "@/features/adresswechsel/umzug";

import { endOf, LINK_INVALID } from "./ends";

import type { ActionAnswer } from "@/core/action";
import type { AdresswechselPresse } from "@/features/adresswechsel/components/views/AdresswechselLinkView";
import type { MailedEnd } from "@/kit/MailedPage";

const { token } = AddressChangePostAddressChangeAnswerBody.shape;

/**
 * The person's own change answered through either link, the side the page read posted beside the token, the
 * pressed act under `act`, `kit/OneShot.tsx`'s field: the main act confirms, the quieter one declines. The side
 * words the end alone; the backend tells the links apart by the token. A link that holds no more at the press,
 * answered, ended or refused since the page opened, ends as the link no longer valid, one message for every cause.
 */
export const answerAddressChange = action({
  lane: "public",
  name: "answerAddressChange",
  input: z.object({ token: token, side: z.enum(["previous", "new"]), act: z.enum(["primary", "secondary"]) }),
  exempt: "The link's token is the whole credential, minted for one mailbox and spent by its answer.",
  run: async ({ token: link, side, act }): Promise<{ ok: true; value: MailedEnd }> => {
    const answer = act === "primary" ? "confirmed" : "declined";
    // The sign-in store is this server's, so the backend's press cannot refuse an account at the new address: refused
    // here, as the backend's own refusals of the address are. A decline is refused nothing.
    if (answer === "confirmed" && side === "new" && (await kontoAnNeuerAdresse({ token: link }))) return { ok: true, value: LINK_INVALID };

    let answered;
    try {
      answered = await postAdresswechselAntwort({ token: link, answer: answer });
    } catch (error) {
      if (mapAdresswechselPresseRefusal(error) === null) throw error;
      return { ok: true, value: LINK_INVALID };
    }

    if (answered.effective) await carryTheAccount();
    return { ok: true, value: endOf(side, answered.answer, answered.approval_open) };
  },
});

/**
 * The account carry the effect owed in its own transaction, awaited before the done end, which invites the sign-in at
 * the new address: a sign-in there while the carry is still owed opens a fresh account, which the carry then finds
 * standing, leaving the person's passkeys on the old one. Next's `after` is for work no answer waits on, and this
 * answer's next page does. A failure is logged and left to the hourly pass, the effect having committed. No address
 * reaches this action.
 */
async function carryTheAccount(): Promise<void> {
  try {
    await runAdresswechselUmzuege();
  } catch (failed) {
    // The name alone: a failure in the sign-in store routinely carries the address.
    logger.error("address_change.carry_failed", undefined, { name: failed instanceof Error ? failed.name : "unknown", ...requestOf(failed) });
  }
}

/**
 * Session 7: the administrator's way answered from its old view, the new mailbox's confirmation and decline and the
 * address on file's stop, each answering what the view shows next.
 */
export const verwaltungswegBeantworten = action({
  lane: "public",
  name: "verwaltungswegBeantworten",
  input: z.object({ token: token, antwort: z.enum(["confirmed", "declined", "stopped"]) }),
  exempt: "The link's token is the whole credential, minted for one mailbox and spent by its answer or its stop.",
  run: async ({ token: link, antwort }): Promise<ActionAnswer<AdresswechselPresse>> => {
    if (antwort === "confirmed" && (await kontoAnNeuerAdresse({ token: link }))) {
      return { ok: true, value: { zustand: "not_confirmable" } };
    }

    try {
      if (antwort === "stopped") {
        await postAdresswechselStopp({ token: link });
        return {
          ok: true,
          value: {
            gedrueckt: { answer: "stopped", effective: false, effective_from: null, approval_open: false },
          },
        };
      }
      const answered = await postAdresswechselAntwort({ token: link, answer: antwort });
      if (answered.effective) afterTheResponse(runAdresswechselUmzuege);
      return { ok: true, value: { gedrueckt: answered } };
    } catch (error) {
      const refusal = mapAdresswechselPresseRefusal(error);
      if (refusal === null) throw error;
      if ("zustand" in refusal) return { ok: true, value: { zustand: refusal.zustand } };
      if (!("neuLesen" in refusal)) return { ok: false, reason: COPY.shared.failure.stale };

      // The change ended or this link was answered since the page opened: the link's own read says how, so the view
      // states it rather than calling the link void. Null where that read failed.
      const ansicht = await postAdresswechselAnsicht({ token: link }).then(ansichtOf, () => null);
      return { ok: true, value: { ansicht: ansicht } };
    }
  },
});
