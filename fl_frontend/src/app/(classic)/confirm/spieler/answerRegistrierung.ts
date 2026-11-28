"use server";

import { redirect } from "next/navigation";

import { z } from "zod";

import { action, ticked, withPostedLabels } from "@/core/action";
import { refusedAs } from "@/core/errors";
import { registrierungenPostConfirmation } from "@/core/generated/client/sdk";
import { RegistrierungenPostConfirmationBody } from "@/core/generated/zod/inputs";
import { forgetMailedLink } from "@/core/mailedLink";
import { ROUTES } from "@/core/routes";

import { entryDoneAt, LINK_INVALID } from "../ends";

import type { Code } from "@/core/generated/client/types";
import type { EndState } from "@/kit/MailedPage";
import type { RegistrierungEnd } from "../ends";

const { shape } = RegistrierungenPostConfirmationBody;

/** What the one act posts, under the payload's own names, and the labels of the wordings the page showed. */
const Answer = z.preprocess(
  withPostedLabels,
  z.object({
    token: shape.token,
    birth_date: shape.birth_date,
    scope: shape.scope,
    media: ticked,
    text_versions: shape.text_versions,
  }),
);

/** The refusals that say the link holds no more since the page opened: lapsed or mistyped. */
const SPENT: ReadonlySet<Code> = new Set<Code>(["link_invalid", "link_expired"]);

/** The refusal saying the pupil confirmed already, in another tab or on another device: the one answer the link takes. */
const CONFIRMED: ReadonlySet<Code> = new Set<Code>(["confirmation_exists"]);

/**
 * A pupil's answer through their link: the birthdate, what of their name the site may show and the media consent,
 * under the labels of the wordings the page showed. A link that holds no more at the press ends as the link no longer
 * valid, one message for every cause; one confirmed since the page opened reaches the done page, saying that the
 * earlier choices stand.
 *
 * Done, the page forgets the link, as the privacy notice says of a mailed link once it is used, and leads on to the
 * confirmation's done page: the link's page, rendered again on the forgotten link, would title the tab and a reload as
 * a link no longer valid.
 */
export const answerRegistrierung = action({
  lane: "public",
  name: "answerRegistrierung",
  input: Answer,
  exempt: "mailedLink",
  // The age the write judges on its own day, which the boxes bound before the send by the page's day: the birthdate's
  // range and the media switch's floor, each on its box from the bounds the refusal carries.
  boxes: ["birth_date", "media"],
  run: async ({ token, birth_date: birthDate, scope, media, text_versions }): Promise<{ ok: true; value: EndState }> => {
    let end: RegistrierungEnd = "confirmed";
    try {
      await registrierungenPostConfirmation({ token, birth_date: birthDate, scope, media, text_versions });
    } catch (error) {
      if (refusedAs(error, SPENT)) return { ok: true, value: LINK_INVALID };
      if (!refusedAs(error, CONFIRMED)) throw error;
      // The earlier confirmation's choices stand, not the ones this press carried.
      end = "kept";
    }
    await forgetMailedLink(ROUTES.registrierungConfirmation.path());
    redirect(entryDoneAt(ROUTES.registrierungConfirmationDone.path(), end));
  },
});
