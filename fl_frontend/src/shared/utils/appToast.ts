import { toast } from "@heroui/react";

import type { ButtonProps } from "@heroui/react";
import type { ReactNode } from "react";

/**
 * A duration is derived from the text's length, never chosen at the call site; the rate sits above an unhurried
 * pace, a toast arriving off the reader's focus. Below the floor a confirmation flickers, above the ceiling it sits.
 */
const NOTICE_MS = 2000;
const MS_PER_CHARACTER = 55;
const MIN_MS = 4000;
const MAX_MS = 14000;

export function readingDuration(title: string, description?: string): number {
  const characters = description === undefined ? title.length : title.length + description.length;

  return Math.min(MAX_MS, Math.max(MIN_MS, NOTICE_MS + characters * MS_PER_CHARACTER));
}

/**
 * A decision window, not a reading time — stated rather than derived by `readingDuration`. Long enough to weigh the sentence naming what
 * went, short enough that the page's data cannot go stale enough for the replay to be refused.
 */
export const UNDO_TIMEOUT_MS = 15000;

interface AppToastOptions {
  /** The detail — what the reader needs in order to act. Omit it when the title is the whole message. */
  description?: string;
  /** Adds a button to the toast. Give it `children` and an `onPress`; `variant` picks its treatment. */
  actionProps?: ButtonProps;
  /** Only for a timing the text length cannot imply — an offer standing until it expires. `0` never auto-closes. */
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
   * A request in flight, closed by its own key when the answer arrives. `timeout: 0` is explicit because HeroUI applies
   * its own default to any `timeout` it is not given — omitting one hides the spinner while the request still runs.
   */
  pending: (title: string) => toast(title, { isLoading: true, timeout: 0 }),

  close: (key: string) => toast.close(key),
  /** Closes every toast, including ones this page did not raise. Prefer `close` where a key exists. */
  clear: () => toast.clear(),
};
