"use server";

import { redirect } from "next/navigation";

import { z } from "zod";

import { action, ticked, withPostedLabels } from "@/core/action";
import { refusedAs } from "@/core/errors";
import { bewerbungenPostConfirmation } from "@/core/generated/client/sdk";
import { BewerbungenPostConfirmationBody } from "@/core/generated/zod/inputs";
import { forgetMailedLink } from "@/core/mailedLink";
import { ROUTES } from "@/core/routes";

import { entryDoneAt, LINK_INVALID } from "../ends";

import type { Code } from "@/core/generated/client/types";
import type { EndState } from "@/kit/MailedPage";
import type { EntryAnswer } from "../ends";

const [given, declined] = BewerbungenPostConfirmationBody.options;

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
      token: given.shape.token,
      birth_date: given.shape.birth_date,
      whatsapp: ticked,
      media: ticked,
      text_versions: given.shape.text_versions,
    }),
    z.object({ act: z.literal("secondary"), token: declined.shape.token }),
  ]),
);

/** The refusals that say the link holds no more since the page opened: lapsed or mistyped. */
const SPENT: ReadonlySet<Code> = new Set<Code>(["link_invalid", "link_expired"]);

/**
 * The done page one answer leads to, or the link no longer valid where the link stopped holding: one message for every
 * cause. Done, the page forgets the link, as the privacy notice says of a mailed link once it is used: the link's page,
 * rendered again on the forgotten link, would title the tab and a reload as a link no longer valid.
 */
async function ended(answer: Parameters<typeof bewerbungenPostConfirmation>[0], kind: EntryAnswer): Promise<{ ok: true; value: EndState }> {
  try {
    await bewerbungenPostConfirmation(answer);
  } catch (error) {
    if (!refusedAs(error, SPENT)) throw error;
    return { ok: true, value: LINK_INVALID };
  }
  await forgetMailedLink(ROUTES.kontaktConfirmation.path());
  redirect(entryDoneAt(ROUTES.kontaktConfirmationDone.path(), kind));
}

/**
 * A contact person's answer through their link: the main act confirms the seat with the birthdate and the two consents,
 * under the labels of the wordings the page showed, which it posts; the refusal objects, emptying the seat.
 */
export const answerKontakt = action({
  lane: "public",
  name: "answerKontakt",
  input: Answer,
  exempt: "mailedLink",
  // The age the write judges on its own day, which the box's range bounds before the send by the page's day: on its
  // box, from the range the refusal carries.
  boxes: ["birth_date"],
  run: async (answer) => {
    if (answer.act === "secondary") return ended({ answer: "declined", token: answer.token }, "objected");
    const { token, birth_date: birthDate, whatsapp, media, text_versions } = answer;
    return ended({ answer: "given", token, birth_date: birthDate, whatsapp, media, text_versions }, "confirmed");
  },
});

/** A closed row's one act, the page's main one: the row takes no confirmation, and a Widerspruch hands nothing over. */
export const objectKontakt = action({
  lane: "public",
  name: "objectKontakt",
  input: z.object({ token: declined.shape.token }),
  exempt: "mailedLink",
  run: async ({ token }) => ended({ answer: "declined", token }, "objected"),
});
