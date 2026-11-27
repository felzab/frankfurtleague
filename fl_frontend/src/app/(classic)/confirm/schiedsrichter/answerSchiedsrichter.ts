"use server";

import { redirect } from "next/navigation";

import { z } from "zod";

import { action, ticked, withPostedLabels } from "@/core/action";
import { refusedAs } from "@/core/errors";
import { schiedsrichterGetConfirmationView, schiedsrichterPostConfirmation, schiedsrichterPostDecline } from "@/core/generated/client/sdk";
import { SchiedsrichterPostConfirmationBody } from "@/core/generated/zod/inputs";
import { forgetMailedLink } from "@/core/mailedLink";
import { ROUTES } from "@/core/routes";

import { END, entryDoneAt, LINK_INVALID } from "../ends";
import { alreadyDone, linkViewOf } from "../linkView";

import type { Code } from "@/core/generated/client/types";
import type { EndState } from "@/kit/MailedPage";
import type { DoneEnd } from "../ends";

const { shape } = SchiedsrichterPostConfirmationBody;

/**
 * What the two acts post, the one-shot form's `act` naming the one pressed: the main act the answer's fields and the
 * labels of the wordings the page showed, the objection the token alone, whatever the fields hold, as an objection
 * hands nothing over.
 */
const Answer = z.preprocess(
  withPostedLabels,
  z.discriminatedUnion("act", [
    z.object({
      act: z.literal("primary"),
      token: shape.token,
      birth_date: shape.birth_date,
      scope: shape.scope,
      media: ticked,
      text_versions: shape.text_versions,
    }),
    z.object({ act: z.literal("secondary"), token: shape.token }),
  ]),
);

/** The refusals that say the link holds no more since the page opened: lapsed or mistyped. */
const SPENT: ReadonlySet<Code> = new Set<Code>(["link_invalid", "link_expired"]);

/** The refusal saying the referee confirmed already, in another tab or on another device: an objection erases the entry. */
const CONFIRMED: ReadonlySet<Code> = new Set<Code>(["confirmation_exists"]);

/**
 * The confirmation standing on the entry, named with its day as the link opened again names it, for an objection that
 * met it: the refusal names no day. The link no longer valid where it holds no more since.
 */
async function confirmationStanding(token: string): Promise<EndState> {
  const view = await linkViewOf(schiedsrichterGetConfirmationView({ token }));
  if (view?.state !== "confirmed") return LINK_INVALID;
  await forgetMailedLink(ROUTES.schiedsrichterConfirmation.path());
  return alreadyDone(view.answered_at, "confirmed", END.confirmed);
}

/**
 * A referee's answer through their link: the main act confirms the entry with the birthdate and the consent, under the
 * labels of the wordings the page showed; the refusal objects, the entry then going when the link lapses. A link
 * that holds no more at the press ends as the link no longer valid, one message for every cause. An entry confirmed
 * since the page opened reaches the end that stands: the done page after a confirmation, saying that the earlier
 * choices stand, and the confirmation and its day after an objection.
 *
 * Done, the page forgets the link, as the privacy notice says of a mailed link once it is used, and leads on to the
 * done page naming the answer: the link's page, rendered again on the forgotten link, would title the tab and a reload
 * as a link no longer valid.
 */
export const answerSchiedsrichter = action({
  lane: "public",
  name: "answerSchiedsrichter",
  input: Answer,
  exempt: "mailedLink",
  // The age the write judges on its own day, which the boxes bound before the send by the page's day: the birthdate's
  // range and the media switch's floor, each on its box from the bounds the refusal carries.
  boxes: ["birth_date", "media"],
  run: async (answer): Promise<{ ok: true; value: EndState }> => {
    let end: DoneEnd = answer.act === "secondary" ? "objected" : "confirmed";
    try {
      if (answer.act === "secondary") {
        await schiedsrichterPostDecline({ token: answer.token });
      } else {
        const { token, birth_date: birthDate, scope, media, text_versions } = answer;
        await schiedsrichterPostConfirmation({ token, birth_date: birthDate, scope, media, text_versions });
      }
    } catch (error) {
      if (refusedAs(error, SPENT)) return { ok: true, value: LINK_INVALID };
      if (!refusedAs(error, CONFIRMED)) throw error;
      if (answer.act === "secondary") return { ok: true, value: await confirmationStanding(answer.token) };
      // The earlier confirmation's choices stand, not the ones this press carried.
      end = "kept";
    }
    await forgetMailedLink(ROUTES.schiedsrichterConfirmation.path());
    redirect(entryDoneAt(ROUTES.schiedsrichterConfirmationDone.path(), end));
  },
});
