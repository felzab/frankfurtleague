"use server";

import { z } from "zod";

import { action } from "@/core/action";
import { SEAT_TEXT_VERSIONS } from "@/core/consentWordings";
import { bewerbungenPostEinwilligung } from "@/core/generated/client/sdk";
import { BewerbungenPostEinwilligungBody } from "@/core/generated/zod/inputs";

import { refusedAs } from "../linkView";
import { END, LINK_INVALID } from "./ends";

import type { Code } from "@/core/generated/client/types";
import type { EndState } from "@/kit/MailedPage";

const [given, declined] = BewerbungenPostEinwilligungBody.options;

/** A ticked box posts „on“, an unticked or unoffered one nothing. */
const ticked = z.preprocess((value) => value === "on", z.boolean());

/**
 * What the two acts post, the one-shot form's `act` naming the one pressed: the main act the answer's fields, the
 * objection the token alone, whatever the fields hold, as an objection hands nothing over.
 */
const Answer = z.discriminatedUnion("act", [
  z.object({
    act: z.literal("primary"),
    token: given.shape.token,
    birth_date: given.shape.birth_date,
    whatsapp: ticked,
    media: ticked,
  }),
  z.object({ act: z.literal("secondary"), token: declined.shape.token }),
]);

/** The refusals that say the link holds no more since the page opened: lapsed or mistyped. */
const SPENT: ReadonlySet<Code> = new Set<Code>(["link_invalid", "link_expired"]);

/** The end one answer reaches, or the link no longer valid where the link stopped holding: one message for every cause. */
async function ended(answer: Parameters<typeof bewerbungenPostEinwilligung>[0], end: EndState): Promise<{ ok: true; value: EndState }> {
  try {
    await bewerbungenPostEinwilligung(answer);
    return { ok: true, value: end };
  } catch (error) {
    if (!refusedAs(error, SPENT)) throw error;
    return { ok: true, value: LINK_INVALID };
  }
}

/**
 * A contact person's answer through their link: the main act confirms the seat with the birthdate and the two consents,
 * under the wordings the page showed; the refusal objects, emptying the seat.
 */
export const answerKontakt = action({
  lane: "public",
  name: "answerKontakt",
  input: Answer,
  exempt: "The link's token is the whole credential, minted for one mailbox and spent by its answer.",
  // The age the write judges on its own day, which the box's range bounds before the send by the page's day: on its
  // box, from the range the refusal carries.
  ownWords: ["confirmation_age"],
  paths: { birth_date: "birth_date" },
  run: async (answer) => {
    if (answer.act === "secondary") return ended({ answer: "declined", token: answer.token }, END.objected);
    const { token, birth_date: birthDate, whatsapp, media } = answer;
    return ended({ answer: "given", token, birth_date: birthDate, whatsapp, media, text_versions: SEAT_TEXT_VERSIONS }, END.confirmed);
  },
});

/** A closed row's one act, the page's main one: the row takes no confirmation, and a Widerspruch hands nothing over. */
export const objectKontakt = action({
  lane: "public",
  name: "objectKontakt",
  input: z.object({ token: declined.shape.token }),
  exempt: "The link's token is the whole credential, minted for one mailbox and spent by its answer.",
  run: async ({ token }) => ended({ answer: "declined", token }, END.objected),
});
