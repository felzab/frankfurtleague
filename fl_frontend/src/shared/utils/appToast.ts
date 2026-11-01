// Redesign: goes with its last importer; `kit/Toast.tsx :: appToast` replaces it.

import { toast } from "@heroui/react/toast";

import { failureToastTitle } from "./failureToastTitle";

import type { ActionFailure } from "@/shared/types/types";
import type { ReactNode } from "react";

/**
 * A duration is derived from the text's length, never chosen at the call site; the rate sits above an unhurried
 * pace, a toast arriving off the reader's focus. Below the floor a confirmation flickers, above the ceiling it sits.
 */
const NOTICE_MS = 2000;
const MS_PER_CHARACTER = 55;
const MIN_MS = 4000;
const MAX_MS = 14000;

function readingDuration(title: string, description?: string): number {
  const characters = description === undefined ? title.length : title.length + description.length;

  return Math.min(MAX_MS, Math.max(MIN_MS, NOTICE_MS + characters * MS_PER_CHARACTER));
}

interface AppToastOptions {
  /** The detail — what the reader needs in order to act. Omit it when the title is the whole message. */
  description?: string;
  /** Replaces the severity glyph. The default is right for almost everything. */
  indicator?: ReactNode;
  onClose?: () => void;
}

function raise(variant: "success" | "warning" | "danger" | "info", title: string, { description, ...rest }: AppToastOptions = {}): string {
  return toast[variant](title, {
    ...rest,
    description,
    timeout: readingDuration(title, description),
  });
}

export const appToast = {
  /** A thing the admin asked for happened. */
  success: (title: string, options?: AppToastOptions) => raise("success", title, options),
  /** It happened, and it cost something the admin may not have intended. Name the cost. */
  warning: (title: string, options?: AppToastOptions) => raise("warning", title, options),
  /** It did not happen. Say whether retrying can help. */
  danger: (title: string, options?: AppToastOptions) => raise("danger", title, options),
  /**
   * An action answered a failure: `title` says what did not happen, and the failure's own sentence is the
   * description. A marked outcome's own title stands in for it.
   */
  failure: (title: string, failure: Pick<ActionFailure, "error" | "unplacedError" | "outcome">, unklarTitle?: string) =>
    // A toast marks nothing, so a refused payload speaks its sentence for a map no control shows.
    raise("danger", failureToastTitle(title, failure.outcome, unklarTitle), {
      description: failure.unplacedError ?? failure.error,
    }),
  /** Neither an outcome nor a failure — a standing fact worth one line. */
  info: (title: string, options?: AppToastOptions) => raise("info", title, options),
};
