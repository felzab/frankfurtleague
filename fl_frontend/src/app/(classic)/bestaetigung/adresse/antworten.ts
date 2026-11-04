"use server";

import { z } from "zod";

import { action } from "@/core/action";
import { afterTheResponse } from "@/core/afterResponse";
import { COPY } from "@/core/copy";
import { AddressChangePostAddressChangeAntwortBody } from "@/core/generated/zod/inputs";
import { kontoAnNeuerAdresse } from "@/features/adresswechsel/konto";
import { ansichtOf } from "@/features/adresswechsel/link";
import { postAdresswechselAnsicht, postAdresswechselAntwort, postAdresswechselStopp } from "@/features/adresswechsel/mutations";
import { mapAdresswechselPresseRefusal } from "@/features/adresswechsel/refusals";
import { runAdresswechselUmzuege } from "@/features/adresswechsel/umzug";

import { endOf, LINK_INVALID } from "./ends";

import type { ActionAnswer } from "@/core/action";
import type { AdresswechselPresse } from "@/features/adresswechsel/components/views/AdresswechselLinkView";
import type { MailedEnd } from "@/kit/MailedPage";

const { token } = AddressChangePostAddressChangeAntwortBody.shape;

/**
 * The person's own change answered through either link, the side the page read posted beside the token, the
 * pressed act under `act`, `kit/OneShot.tsx`'s field: the main act confirms, the quieter one declines. The side
 * words the end alone; the backend tells the links apart by the token. A link that holds no more at the press,
 * answered, ended or refused since the page opened, ends as the link no longer valid, one message for every cause.
 */
export const adresseBeantworten = action({
  lane: "public",
  name: "adresseBeantworten",
  input: z.object({ token: token, seite: z.enum(["previous", "new"]), act: z.enum(["primary", "secondary"]) }),
  exempt: "The link's token is the whole credential, minted for one mailbox and spent by its answer.",
  run: async ({ token: link, seite, act }): Promise<{ ok: true; value: MailedEnd }> => {
    const antwort = act === "primary" ? "confirmed" : "declined";
    // The sign-in store is this server's, so the backend's press cannot refuse an account at the new address: refused
    // here, as the backend's own refusals of the address are. A decline is refused nothing.
    if (antwort === "confirmed" && seite === "new" && (await kontoAnNeuerAdresse({ token: link }))) return { ok: true, value: LINK_INVALID };

    let answered;
    try {
      answered = await postAdresswechselAntwort({ token: link, antwort: antwort });
    } catch (error) {
      if (mapAdresswechselPresseRefusal(error) === null) throw error;
      return { ok: true, value: LINK_INVALID };
    }

    // The effect owed its account's carry in its own transaction: behind the response, and by the hourly pass where
    // this one never runs. No address reaches this action.
    if (answered.effective) afterTheResponse(runAdresswechselUmzuege);
    return { ok: true, value: endOf(seite, answered.antwort, answered.approval_open) };
  },
});

/**
 * Session 7: the administrator's ways answered from their old view, the new mailbox's confirmation and decline and the
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
            gedrueckt: { antwort: "stopped", effective: false, effective_from: null, approval_open: false },
          },
        };
      }
      const answered = await postAdresswechselAntwort({ token: link, antwort: antwort });
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
