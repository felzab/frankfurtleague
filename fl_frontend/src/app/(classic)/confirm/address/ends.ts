import "server-only";

import { linkInvalid, TO_ACCOUNT } from "@/kit/MailedPage";

import { COPY } from "@/core/copy";
import { dayIn } from "@/core/format";
import { ROUTES } from "@/core/routes";
import { SERVER_COPY } from "@/core/serverCopy";

import type { CalendarDay } from "@/core/format";
import type { FLAddressChangeWay } from "@/core/generated/client/types";
import type { EndState } from "@/kit/MailedPage";

const WORDS = SERVER_COPY.addressChange;

const TO_HOME = { label: COPY.shared.end.toHome, href: ROUTES.home.path() };

/** The link's side, the address on file's or the new mailbox's, which words its question and its ends. */
export type Side = "previous" | "new";

/** A link that holds no more at the press: answered, ended or refused since the page opened. */
export const LINK_INVALID: EndState = linkInvalid(TO_ACCOUNT);

/** The address on file's stop, on the danger tint, leading to the start page. */
export const STOPPED: EndState = { tone: "danger", title: WORDS.previous.stopped, next: TO_HOME };

/** What the person did through either link, as its done state says it and an opened-again link names it. */
const DONE = {
  previous: WORDS.previous.confirmed,
  new: WORDS.new.confirmed,
} as const;

/** Where a confirmation leads: Konto, on the person's own change; the start page after the administration's, whose reader may hold no sign-in yet. */
const wayOn = (way: FLAddressChangeWay) => (way === "account" ? TO_ACCOUNT : TO_HOME);

/**
 * The end an answer reaches. The new address's confirmation leads to signing in with it; the address on file's to
 * Konto, where the change waits on the new mailbox; a decline, on the danger tint, to the start page. A confirmed change
 * that waits says so in the done state's title with its day, on the info tint, in place of the sign-in.
 */
export function endOf(side: Side, answer: "confirmed" | "declined", effectiveFrom: string | null, way: FLAddressChangeWay): EndState {
  if (answer === "declined") return { tone: "danger", title: WORDS.declined, next: TO_HOME };
  if (side === "previous") return { tone: "success", title: DONE.previous, next: TO_ACCOUNT };
  if (effectiveFrom !== null) return { tone: "info", title: WORDS.new.confirmedFrom(dayIn(new Date(effectiveFrom))), next: wayOn(way) };
  return { tone: "success", title: DONE.new, next: { label: COPY.shared.verb.signIn, href: ROUTES.signIn.path() } };
}

/** A link opened again: what its holder did, and the day, leading on as the answer did, or to the start page after a decline. */
export function doneOnEnd(side: Side, answer: "confirmed" | "declined", day: CalendarDay, way: FLAddressChangeWay) {
  return answer === "declined"
    ? { state: "alreadyDone" as const, title: COPY.shared.end.doneOn(WORDS.declined, day), next: TO_HOME, declined: true }
    : { state: "alreadyDone" as const, title: COPY.shared.end.doneOn(DONE[side], day), next: wayOn(way) };
}

/** The new mailbox's link opened again in the wait, saying what the press's own done state said. */
export function confirmedAgain(day: CalendarDay, effectiveFrom: string | null, way: FLAddressChangeWay) {
  if (effectiveFrom === null) return doneOnEnd("new", "confirmed", day, way);
  return { state: "alreadyDone" as const, title: WORDS.new.confirmedFrom(dayIn(new Date(effectiveFrom))), next: wayOn(way) };
}

/** The stop link opened again, on the tint its done state took. */
export function stoppedOn(day: CalendarDay) {
  return { state: "alreadyDone" as const, title: COPY.shared.end.doneOn(WORDS.previous.stopped, day), next: TO_HOME, declined: true };
}
