import "server-only";

import { linkInvalid, TO_ACCOUNT } from "@/kit/MailedPage";

import { COPY } from "@/core/copy";
import { ROUTES } from "@/core/routes";
import { SERVER_COPY } from "@/core/serverCopy";

import type { CalendarDay } from "@/core/format";
import type { EndState } from "@/kit/MailedPage";

const WORDS = SERVER_COPY.addressChange;

const TO_HOME = { label: COPY.shared.end.toHome, href: ROUTES.home.path() };

/** The link's side, the address on file's or the new mailbox's, which words its question and its ends. */
export type Side = "previous" | "new";

/** A link that holds no more at the press: answered, ended or refused since the page opened. */
export const LINK_INVALID: EndState = linkInvalid(TO_ACCOUNT);

/** What the person did through either link, as its done state says it and an opened-again link names it. */
const DONE = {
  previous: WORDS.previous.confirmed,
  new: WORDS.new.confirmed,
} as const;

/**
 * The end an answer reaches. The new address's confirmation leads to signing in with it; the address on file's to
 * Konto, where the change waits on the new mailbox; a decline, on the danger tint, to the start page. A grant holder's
 * confirmed change still waits on its approval, which the done state's title says, on the info tint, and leads to
 * Konto, where the waiting change stands, in place of the sign-in.
 */
export function endOf(side: Side, answer: "confirmed" | "declined", approvalOpen: boolean): EndState {
  if (answer === "declined") return { tone: "danger", title: WORDS.declined, next: TO_HOME };
  if (side === "previous") return { tone: "success", title: DONE.previous, next: TO_ACCOUNT };
  if (approvalOpen) return { tone: "info", title: WORDS.new.awaitsApproval, next: TO_ACCOUNT };
  return { tone: "success", title: DONE.new, next: { label: COPY.shared.verb.signIn, href: ROUTES.signIn.path() } };
}

/** A link opened again: what its holder did, and the day, with the one place to change it, or the start page after a decline. */
export function doneOnEnd(side: Side, answer: "confirmed" | "declined", day: CalendarDay) {
  return answer === "declined"
    ? { state: "alreadyDone" as const, title: COPY.shared.end.doneOn(WORDS.declined, day), next: TO_HOME, declined: true }
    : { state: "alreadyDone" as const, title: COPY.shared.end.doneOn(DONE[side], day), next: TO_ACCOUNT };
}
