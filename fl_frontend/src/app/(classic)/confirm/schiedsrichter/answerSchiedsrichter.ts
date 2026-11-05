"use server";

import { z } from "zod";

import { action } from "@/core/action";
import { SCHIEDSRICHTER_TEXT_VERSIONS } from "@/core/consentWordings";
import { APIBadStatusError } from "@/core/errors";
import { schiedsrichterPostConfirmation, schiedsrichterPostDecline } from "@/core/generated/client/sdk";
import { SchiedsrichterPostConfirmationBody } from "@/core/generated/zod/inputs";

import { END, LINK_INVALID } from "./ends";

import type { Code } from "@/core/generated/client/types";
import type { EndState } from "@/kit/MailedPage";

const { shape } = SchiedsrichterPostConfirmationBody;

/**
 * What the two acts post, `kit/OneShot.tsx`'s `act` naming the one pressed: the main act the answer's fields, the
 * objection the token alone, whatever the fields hold, as an objection hands nothing over. A ticked box posts „on“,
 * an unticked or unoffered one nothing.
 */
const Answer = z.discriminatedUnion("act", [
  z.object({
    act: z.literal("primary"),
    token: shape.token,
    geburtsdatum: shape.geburtsdatum,
    scope: shape.scope,
    media: z.preprocess((value) => value === "on", z.boolean()),
  }),
  z.object({ act: z.literal("secondary"), token: shape.token }),
]);

/** The refusals that say the link holds no more since the page opened: answered, lapsed, mistyped or barred since. */
const SPENT: ReadonlySet<Code> = new Set<Code>(["link_invalid", "link_expired", "link_barred", "confirmation_exists"]);

const spent = (error: unknown) => error instanceof APIBadStatusError && error.serverErrorCode !== undefined && SPENT.has(error.serverErrorCode);

/**
 * A referee's answer through their link: the main act confirms the entry with the birthdate and the consent, under the
 * labels of the wordings the page showed; the quieter one objects, the entry then going when the link lapses. A link
 * that holds no more at the press ends as the link no longer valid, one message for every cause.
 */
export const answerSchiedsrichter = action({
  lane: "public",
  name: "answerSchiedsrichter",
  input: Answer,
  exempt: "The link's token is the whole credential, minted for one mailbox and spent by its answer.",
  // The age the write judges on its own day, which the box's range bounds before the send by the page's day: on its
  // box, from the range the refusal carries.
  ownWords: ["confirmation_age"],
  paths: { geburtsdatum: "geburtsdatum" },
  run: async (answer): Promise<{ ok: true; value: EndState }> => {
    try {
      if (answer.act === "secondary") {
        await schiedsrichterPostDecline({ token: answer.token });
        return { ok: true, value: END.objected };
      }
      const { token, geburtsdatum, scope, media } = answer;
      await schiedsrichterPostConfirmation({ token, geburtsdatum, scope, media, text_versions: SCHIEDSRICHTER_TEXT_VERSIONS });
      return { ok: true, value: END.confirmed };
    } catch (error) {
      if (!spent(error)) throw error;
      return { ok: true, value: LINK_INVALID };
    }
  },
});
