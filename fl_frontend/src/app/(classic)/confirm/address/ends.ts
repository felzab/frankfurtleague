import "server-only";

import { notFound } from "next/navigation";

import { z } from "zod";

import { COPY } from "@/core/copy/shared";
import { dayIn, dayOf } from "@/core/format";
import { ROUTES } from "@/core/routes";
import { SERVER_COPY } from "@/core/serverCopy";
import { linkInvalid, TO_HOME } from "@/kit/mailedLinkState";
import { TO_ACCOUNT } from "@/kit/MailedPage";

import { TO_SIGN_IN } from "../ends";

import type { CalendarDay } from "@/core/format";
import type { FLAddressChangeWay } from "@/core/generated/client/types";
import type { EndState } from "@/kit/MailedPage";
import type { DoneQuery } from "../ends";

const WORDS = SERVER_COPY.addressChange;

/** The link's side, the address on file's or the new mailbox's, which words its question and its ends. */
export type Side = "previous" | "new";

/** A link that holds no more at the press: answered, ended or refused since the page opened. */
export const LINK_INVALID: EndState = linkInvalid(TO_ACCOUNT);

/** What the person did through either link, as its done state says it and an opened-again link names it. */
const DONE = {
  previous: WORDS.previous.confirmed,
  new: WORDS.new.confirmed,
} as const;

/** Where a confirmation leads: Konto, on the person's own change; the start page after the administration's, whose reader may hold no sign-in yet. */
const wayOn = (way: FLAddressChangeWay) => (way === "account" ? TO_ACCOUNT : TO_HOME);

/**
 * The ends an answer or the stop reaches, by the name its done page's address carries. The new address's confirmation
 * leads to signing in with it; the address on file's to Konto, where the change waits on the new mailbox; a decline and
 * the stop, on the danger tint, to the start page.
 */
const ENDS = {
  previous: { tone: "success", title: DONE.previous, next: TO_ACCOUNT },
  new: { tone: "success", title: DONE.new, next: TO_SIGN_IN },
  declined: { tone: "danger", title: WORDS.declined, next: TO_HOME },
  stopped: { tone: "danger", title: WORDS.previous.stopped, next: TO_HOME },
} as const satisfies Readonly<Record<string, EndState>>;

/**
 * What the done page's address names: one of `ENDS`, or a confirmed change that waits, with the day it holds from and
 * its way, which decides where it leads. Nothing else, so no address and no token ever stands in it.
 */
const Done = z.union([
  z.strictObject({ end: z.enum(["previous", "new", "declined", "stopped"]) }),
  z.strictObject({ end: z.literal("waits"), from: z.iso.date(), way: z.enum(["account", "waiting_period"]) }),
]);

const doneAddress = (done: z.infer<typeof Done>): string => `${ROUTES.addressChangeDone.path()}?${new URLSearchParams(done)}`;

/** The done page an answer leads to: a confirmed change that waits says so with its day, in place of the sign-in. */
export function doneAt(side: Side, answer: "confirmed" | "declined", effectiveFrom: string | null, way: FLAddressChangeWay): string {
  if (answer === "declined") return doneAddress({ end: "declined" });
  if (side === "previous") return doneAddress({ end: "previous" });
  if (effectiveFrom !== null) return doneAddress({ end: "waits", from: dayIn(new Date(effectiveFrom)), way });
  return doneAddress({ end: "new" });
}

export const STOPPED_AT = doneAddress({ end: "stopped" });

/** The end the done page draws, on the info tint for a waited change, or Next's not-found page for any other query. */
export async function endOfDone(query: DoneQuery): Promise<EndState> {
  const read = Done.safeParse(await query);
  if (!read.success) notFound();
  const done = read.data;
  return done.end === "waits" ? { tone: "info", title: WORDS.new.confirmedFrom(dayOf(done.from)), next: wayOn(done.way) } : ENDS[done.end];
}

/** A link opened again: what its holder did, and the day, leading on as the answer did, or to the start page after a decline. */
export function doneOnEnd(side: Side, answer: "confirmed" | "declined", day: CalendarDay, way: FLAddressChangeWay) {
  return answer === "declined"
    ? { state: "end" as const, tone: "danger" as const, title: COPY.shared.end.doneOn(WORDS.declined, day), next: TO_HOME }
    : { state: "end" as const, tone: "info" as const, title: COPY.shared.end.doneOn(DONE[side], day), next: wayOn(way) };
}

/** The new mailbox's link opened again in the wait, saying what the press's own done state said. */
export function confirmedAgain(day: CalendarDay, effectiveFrom: string | null, way: FLAddressChangeWay) {
  if (effectiveFrom === null) return doneOnEnd("new", "confirmed", day, way);
  return { state: "end" as const, tone: "info" as const, title: WORDS.new.confirmedFrom(dayIn(new Date(effectiveFrom))), next: wayOn(way) };
}

/** The stop link opened again, on the tint its done state took. */
export function stoppedOn(day: CalendarDay) {
  return { state: "end" as const, tone: "danger" as const, title: COPY.shared.end.doneOn(WORDS.previous.stopped, day), next: TO_HOME };
}
