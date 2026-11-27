"use server";

import { redirect } from "next/navigation";

import { z } from "zod";

import { action, ticked, withPostedLabels } from "@/core/action";
import { refusedAs } from "@/core/errors";
import { bewerbungenGetConfirmationView, bewerbungenPostConfirmation } from "@/core/generated/client/sdk";
import { BewerbungenPostConfirmationBody } from "@/core/generated/zod/inputs";
import { forgetMailedLink } from "@/core/mailedLink";
import { ROUTES } from "@/core/routes";

import { END, entryDoneAt, LINK_INVALID } from "../ends";
import { alreadyDone, linkViewOf } from "../linkView";

import type { Code } from "@/core/generated/client/types";
import type { EndState } from "@/kit/MailedPage";
import type { DoneEnd, EntryAnswer } from "../ends";

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

/** The refusal saying the seat's person answered already, in another tab or on another device. */
const ANSWERED: ReadonlySet<Code> = new Set<Code>(["bewerbung_seat_already_answered"]);

/**
 * The answer standing on an answered seat and its day, read off the link's view, since the refusal names neither; `null`
 * where the link holds no more. A seat found answered never reads open again on the same token: a person seated afresh
 * is mailed a fresh link.
 */
async function standingAnswer(token: string): Promise<{ kind: EntryAnswer; answeredAt: string } | null> {
  const view = await linkViewOf(bewerbungenGetConfirmationView({ token }));
  if (view?.state === "confirmed") return { kind: "confirmed", answeredAt: view.answered_at };
  if (view?.state === "declined") return { kind: "objected", answeredAt: view.answered_at };
  return null;
}

/**
 * The done page one answer leads to, or the link no longer valid where the link stopped holding: one message for every
 * cause. A seat answered since the page opened reaches the end that stands: the done page where it is the answer
 * pressed, a confirmation's saying that the earlier choices stand, else the link opened again, naming the other answer
 * and its day. Done, the page forgets the link, as the
 * privacy notice says of a mailed link once it is used: the link's page, rendered again on the forgotten link, would
 * title the tab and a reload as a link no longer valid.
 */
async function ended(answer: Parameters<typeof bewerbungenPostConfirmation>[0], kind: EntryAnswer): Promise<{ ok: true; value: EndState }> {
  let end: DoneEnd = kind;
  try {
    await bewerbungenPostConfirmation(answer);
  } catch (error) {
    if (refusedAs(error, SPENT)) return { ok: true, value: LINK_INVALID };
    if (!refusedAs(error, ANSWERED)) throw error;
    const standing = await standingAnswer(answer.token);
    if (standing === null) return { ok: true, value: LINK_INVALID };
    if (standing.kind !== kind) {
      await forgetMailedLink(ROUTES.kontaktConfirmation.path());
      return { ok: true, value: alreadyDone(standing.answeredAt, standing.kind, END[standing.kind]) };
    }
    // The earlier confirmation's choices stand, not the ones this press carried.
    if (kind === "confirmed") end = "kept";
  }
  await forgetMailedLink(ROUTES.kontaktConfirmation.path());
  redirect(entryDoneAt(ROUTES.kontaktConfirmationDone.path(), end));
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
  // The age the write judges on its own day, which the boxes bound before the send by the page's day: the birthdate's
  // range and the media switch's floor, each on its box from the bounds the refusal carries.
  boxes: ["birth_date", "media"],
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
