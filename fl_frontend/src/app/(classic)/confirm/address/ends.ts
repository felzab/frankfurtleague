import "server-only";

import { linkInvalid, TO_ACCOUNT } from "@/kit/MailedPage";

import { COPY } from "@/core/copy";
import { ROUTES } from "@/core/routes";
import { SERVER_COPY } from "@/core/serverCopy";

import type { CalendarDay } from "@/core/format";
import type { MailedEnd } from "@/kit/MailedPage";

const WORDS = SERVER_COPY.addressChange;

const TO_HOME = { label: COPY.shared.end.toHome, href: ROUTES.home.path() };

/** The link's side, the address on file's or the new mailbox's, which words its question and its ends. */
export type Side = "previous" | "new";

/** A link that holds no more at the press: answered, ended or refused since the page opened. */
export const LINK_INVALID: MailedEnd = linkInvalid(TO_ACCOUNT);

/** What the person did through either link, as its done state says it and an opened-again link names it. */
const DONE = {
  previous: WORDS.previous.confirmed,
  new: WORDS.new.confirmed,
} as const;

/**
 * The end an answer reaches. The new address's confirmation leads to signing in with it; the address on file's to
 * Konto, where the change waits on the new mailbox; a decline, on the danger tint, to the start page. A grant holder's
 * confirmed change still waits on its approval, which the done state says in place of the sign-in.
 */
export function endOf(side: Side, answer: "confirmed" | "declined", approvalOpen: boolean): MailedEnd {
  if (answer === "declined") return { tone: "danger", title: WORDS.declined, sentence: WORDS.declinedSentence, next: TO_HOME };
  if (side === "previous") return { tone: "success", title: DONE.previous, sentence: WORDS.previous.confirmedSentence, next: TO_ACCOUNT };
  if (approvalOpen) return { tone: "success", title: DONE.new, sentence: WORDS.new.awaitsApproval, next: TO_ACCOUNT };
  return {
    tone: "success",
    title: DONE.new,
    sentence: WORDS.new.confirmedSentence,
    next: { label: COPY.shared.verb.signIn, href: ROUTES.signIn.path() },
  };
}

/** A link opened again: what its holder did, and the day, with the one place to change it, or the start page after a decline. */
export function doneOnEnd(side: Side, answer: "confirmed" | "declined", day: CalendarDay) {
  return answer === "declined"
    ? {
        state: "schonErledigt" as const,
        title: WORDS.declined,
        sentence: COPY.shared.end.doneOn(WORDS.declined, day),
        next: TO_HOME,
        declined: true,
      }
    : { state: "schonErledigt" as const, title: DONE[side], sentence: COPY.shared.end.doneOn(DONE[side], day), next: TO_ACCOUNT };
}
