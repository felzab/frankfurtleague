"use server";

import { z } from "zod";

import { action } from "@/core/action";
import { SPIELER_TEXT_VERSIONS } from "@/core/consentWordings";
import { registrierungenPostConfirmation } from "@/core/generated/client/sdk";
import { RegistrierungenPostConfirmationBody } from "@/core/generated/zod/inputs";

import { refusedAs } from "../linkView";
import { CONFIRMED, LINK_INVALID } from "./ends";

import type { Code } from "@/core/generated/client/types";
import type { EndState } from "@/kit/MailedPage";

const { shape } = RegistrierungenPostConfirmationBody;

/** What the one act posts, under the payload's own names. A ticked box posts „on“, an unticked or unoffered one nothing. */
const Answer = z.object({
  token: shape.token,
  birth_date: shape.birth_date,
  scope: shape.scope,
  media: z.preprocess((value) => value === "on", z.boolean()),
});

/** The refusals that say the link holds no more since the page opened: answered, lapsed or mistyped. */
const SPENT: ReadonlySet<Code> = new Set<Code>(["link_invalid", "link_expired", "confirmation_exists"]);

/**
 * A pupil's answer through their link: the birthdate, what of their name the site may show and the media consent,
 * under the labels of the wordings the page showed. A link that holds no more at the press ends as the link no longer
 * valid, one message for every cause.
 */
export const answerRegistrierung = action({
  lane: "public",
  name: "answerRegistrierung",
  input: Answer,
  exempt: "The link's token is the whole credential, minted for one mailbox and spent by its answer.",
  // The age the write judges on its own day, which the box's range bounds before the send by the page's day: on its
  // box, from the range the refusal carries.
  ownWords: ["confirmation_age"],
  paths: { birth_date: "birth_date" },
  run: async ({ token, birth_date: birthDate, scope, media }): Promise<{ ok: true; value: EndState }> => {
    try {
      await registrierungenPostConfirmation({ token, birth_date: birthDate, scope, media, text_versions: SPIELER_TEXT_VERSIONS });
      return { ok: true, value: CONFIRMED };
    } catch (error) {
      if (!refusedAs(error, SPENT)) throw error;
      return { ok: true, value: LINK_INVALID };
    }
  },
});
