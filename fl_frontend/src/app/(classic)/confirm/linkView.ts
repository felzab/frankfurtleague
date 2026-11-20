import { COPY } from "@/core/copy/shared";
import { APIBadStatusError } from "@/core/errors";
import { dayOf } from "@/core/format";
import { TO_ACCOUNT } from "@/kit/MailedPage";

import { TO_HOME } from "./ends";

import type { Code } from "@/core/generated/client/types";
import type { EndState, MailedState } from "@/kit/MailedPage";

export const refusedAs = (error: unknown, codes: ReadonlySet<Code>): boolean =>
  error instanceof APIBadStatusError && error.serverErrorCode !== undefined && codes.has(error.serverErrorCode);

/** A token no record holds, and one the backend will not parse: a dead link either way. */
const DEAD: ReadonlySet<Code> = new Set<Code>(["link_invalid", "payload_refused"]);

/**
 * A confirmation link's own read, `null` for a dead link. A failed read is no state of the link's: it reaches the
 * frame's error boundary, which logs it.
 */
export function linkViewOf<View>(read: Promise<View>): Promise<View | null> {
  return read.catch((error: unknown) => {
    if (refusedAs(error, DEAD)) return null;
    throw error;
  });
}

/**
 * A confirmation link opened again after its answer: `end`'s title with the day, and the one place to go next, Konto
 * after a confirmation and the start page, on the danger tint, after an objection.
 */
export function alreadyDone(answeredAt: string, kind: "confirmed" | "objected", end: EndState): MailedState {
  const title = COPY.shared.end.doneOn(end.title, dayOf(answeredAt));
  return kind === "confirmed"
    ? { state: "alreadyDone", title, next: TO_ACCOUNT }
    : { state: "alreadyDone", title, next: TO_HOME, declined: true };
}
