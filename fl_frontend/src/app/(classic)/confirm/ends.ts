import "server-only";

import { notFound } from "next/navigation";

import { z } from "zod";

import { COPY } from "@/core/copy/shared";
import { ROUTES } from "@/core/routes";
import { SERVER_COPY } from "@/core/serverCopy";
import { linkInvalid, TO_HOME } from "@/kit/mailedLinkState";

import type { EndState } from "@/kit/MailedPage";

const WORDS = SERVER_COPY.entryConfirmation;

export const LINK_INVALID: EndState = linkInvalid(TO_HOME);

/** The way on to signing in, which a confirmed entry and a confirmed new address both lead to. */
export const TO_SIGN_IN = { label: COPY.shared.verb.signIn, href: ROUTES.signIn.path() };

/**
 * The end an entry's answer reaches, a contact's seat and a referee's entry alike, its title saying all there is: a
 * confirmed entry leads to signing in, which the person may now do with the address the link went to; an objection,
 * on the danger tint, to the start page.
 */
export const END = {
  confirmed: { tone: "success", title: WORDS.confirmed, next: TO_SIGN_IN },
  objected: { tone: "danger", title: WORDS.objected, next: TO_HOME },
} as const satisfies Readonly<Record<string, EndState>>;

/**
 * The end a pupil's answer reaches, its title saying all there is: the registration waits on the team, which mails the
 * pupil nothing when it admits them, so the card promises no word to come and leads to signing in.
 */
export const REGISTRIERUNG_CONFIRMED = {
  tone: "success",
  title: SERVER_COPY.registrierungConfirmation.confirmed,
  next: TO_SIGN_IN,
} as const satisfies EndState;

/** Which of `END` an entry's answer reached. */
export type EntryAnswer = keyof typeof END;

/** A done page's query, as Next hands it to the page. */
export type DoneQuery = Promise<Readonly<Record<string, string | string[] | undefined>>>;

/**
 * The end an entry's done page draws: an answer's, or `kept`, a confirmation that met one already standing, since
 * another tab or device confirmed first. The earlier press's choices stand there, so its card says so.
 */
export type DoneEnd = EntryAnswer | "kept";

const DONE_ENDS = {
  ...END,
  kept: { ...END.confirmed, sentence: WORDS.choicesKept },
} as const satisfies Readonly<Record<DoneEnd, EndState>>;

/** What an entry's done page reads: an end other than a confirmation's, whose address carries nothing. */
const EntryDone = z.strictObject({ end: z.enum(["objected", "kept"]).optional() });

/** The done page an entry's end leads to, `done` being the contact's or the referee's. */
export const entryDoneAt = (done: string, end: DoneEnd): string => (end === "confirmed" ? done : `${done}?end=${end}`);

/** The end an entry's done page draws, or Next's not-found page for any query no answer leads to. */
export async function entryEndOf(query: DoneQuery): Promise<EndState> {
  const read = EntryDone.safeParse(await query);
  if (!read.success) notFound();
  return DONE_ENDS[read.data.end ?? "confirmed"];
}
