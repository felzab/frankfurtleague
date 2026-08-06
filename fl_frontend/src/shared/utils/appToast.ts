/**
 * SHARED · the one way this app raises a toast
 *
 * Wraps HeroUI's `toast` so that the two things every producer used to get wrong are decided here
 * instead of at each call site: **how long the message stays**, and **which half of it is the
 * outcome**. `AppToaster` is the other half of the pair — it owns what a toast looks like, this owns
 * what one says and for how long.
 *
 *  INVARIANTS ───────────────────────────────────────────────────────────────────────────────────────
 *
 *   • **A title is an outcome, a description is the detail.** The title says what happened in one
 *     clause and is the only part a reader is guaranteed to take in; anything they would need in
 *     order to act goes in the description. A producer with one string passes a title and nothing
 *     else — never a sentence pair joined with ". " into the title, which is what
 *     `formatSpielUpdateMessage` used to hand over.
 *   • **Durations are derived, not chosen.** `timeout` is a last resort for the cases the formula
 *     cannot know about (an offer with an action on it, a request still in flight). Passing one
 *     because a message "feels long" is how the four-second default came to sit under a five-sentence
 *     fault report.
 *   • **Both halves are `string`, deliberately.** The duration is derived from their length, and a
 *     `ReactNode` cannot be measured — a node-valued title would silently take the floor duration.
 *     `indicator` and `actionProps.children` stay nodes because neither is read for time.
 */

import { toast } from "@heroui/react";

import type { ButtonProps } from "@heroui/react";
import type { ReactNode } from "react";

/**
 * How long a toast stays, derived from how long its text takes to read.
 *
 * **The numbers, and where they come from.** Sustained silent reading of connected prose runs at
 * roughly 200 words per minute; German averages close to seven characters per word once the space is
 * counted, which puts an unhurried reader near 23 characters per second, or ~43 ms per character.
 * `MS_PER_CHARACTER` is set above that because a toast is not connected prose — it arrives
 * unannounced, off the reader's focus, and is often read once from a standing start.
 *
 * `NOTICE_MS` is the part that is not reading at all: the toast has to be seen before it can be read,
 * and it enters from off-screen behind an animation.
 *
 * **The floor and the ceiling are what actually matter.** Below `MIN_MS` a one-word confirmation
 * flickers; above `MAX_MS` an unattended toast is furniture, and anything that genuinely needs longer
 * needs an action on it instead — at which point the producer states its own timeout, as the undo
 * offer does.
 */
const NOTICE_MS = 2000;
const MS_PER_CHARACTER = 55;
const MIN_MS = 4000;
const MAX_MS = 14000;

export function readingDuration(title: string, description?: string): number {
  const characters = description === undefined ? title.length : title.length + description.length;

  return Math.min(MAX_MS, Math.max(MIN_MS, NOTICE_MS + characters * MS_PER_CHARACTER));
}

interface AppToastOptions {
  /** The detail — what the reader needs in order to act. Omit it when the title is the whole message. */
  description?: string;
  /** Adds a button to the toast. Give it `children` and an `onPress`; `variant` picks its treatment. */
  actionProps?: ButtonProps;
  /**
   * Overrides the derived duration. **Only for a timing the text length cannot imply** — an offer
   * that stands until it expires, or a message that must outlive a decision. `0` never auto-closes.
   */
  timeout?: number;
  /** Replaces the severity glyph. The default is right for almost everything. */
  indicator?: ReactNode;
  onClose?: () => void;
}

function raise(
  variant: "success" | "warning" | "danger" | "info",
  title: string,
  { description, timeout, ...rest }: AppToastOptions = {},
): string {
  return toast[variant](title, {
    ...rest,
    description,
    timeout: timeout ?? readingDuration(title, description),
  });
}

export const appToast = {
  /** A thing the admin asked for happened. */
  success: (title: string, options?: AppToastOptions) => raise("success", title, options),
  /** It happened, and it cost something the admin may not have intended. Name the cost. */
  warning: (title: string, options?: AppToastOptions) => raise("warning", title, options),
  /** It did not happen. Say whether retrying can help. */
  danger: (title: string, options?: AppToastOptions) => raise("danger", title, options),
  /** Neither an outcome nor a failure — a standing fact worth one line. */
  info: (title: string, options?: AppToastOptions) => raise("info", title, options),

  /**
   * A request is in flight and the press needs to look like it did something.
   *
   * **Never auto-closes, and that is the whole point** — it is closed by its own key when the answer
   * arrives. HeroUI applies its four-second default to any `timeout` it is not given, so omitting one
   * here does not mean "no timeout"; it means the spinner disappears after four seconds while the
   * request is still running, which is exactly the state this toast exists to rule out.
   */
  pending: (title: string) => toast(title, { isLoading: true, timeout: 0 }),

  /** Closes one toast by the key its raiser returned. */
  close: (key: string) => toast.close(key),
  /** Closes every toast, including ones this page did not raise. Prefer `close` where a key exists. */
  clear: () => toast.clear(),
};
