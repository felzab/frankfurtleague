"use client";

import {
  UNSTABLE_Toast as AriaToast,
  UNSTABLE_ToastRegion as AriaToastRegion,
  Text,
  UNSTABLE_ToastContent as ToastContent,
  UNSTABLE_ToastQueue as ToastQueue,
} from "react-aria-components/Toast";

import { COPY } from "@/core/copy/shared";

import { Button } from "./Button";
import { Icon } from "./Icon";
import { useRailCollapsed } from "./railContext";
import { tv } from "./tv";
import { answerLine } from "./useFormAction";

import type { ActionAnswer } from "@/core/action";
import type { Copy } from "@/core/copy";
import type { AnswerTone } from "./useFormAction";

// React Aria exports its toast under `UNSTABLE_` names alone: the API may change in a minor release.
type ToastContentData = { tone: AnswerTone; title: Copy };

/** Each tone's hue, as a status card marks the same outcome. */
const TONE_CLASSES: Readonly<Record<AnswerTone, string>> = { success: "text-success", warn: "text-warn", danger: "text-danger" };

/** Each tone's glyph, a status card's. */
const GLYPH = { success: "done", warn: "warning", danger: "error" } as const;

const queue = new ToastQueue<ToastContentData>();

// React Aria's documented floor for a toast that closes itself, so every reader has time for it.
const TIMEOUT_MS = 5000;

/**
 * Reports an outcome that has no place on the page: a title alone, from the catalogue's toast titles.
 * The one way to raise a toast. A done act's word closes itself; with `stands`, the toast stays until it is closed,
 * since the page says it nowhere else: a refusal, a partial outcome, and a done act's note, which says what else the act
 * did, such as the other fixtures a date's save moved. React Aria's rule: "Only auto-dismiss toasts when the
 * information is not critical, or may be found elsewhere" (https://react-aria.adobe.com/Toast). A title alone brings no
 * note, so by default only a done one closes itself.
 */
export function appToast(tone: AnswerTone, title: Copy, stands = tone !== "success") {
  queue.add({ tone, title }, stands ? undefined : { timeout: TIMEOUT_MS });
}

/**
 * An act's answer as its toast, worded and toned as a form's status line words the same answer (`answerLine`). `done`
 * is the act's own done word, never its answer's note, and a done answer naming the act it did instead brings that
 * act's word (`ActionAnswer`'s `done`): a note other than the act's word stands until it is closed.
 */
export function toastAnswer(answer: ActionAnswer<unknown>, done: Copy) {
  // A passkey sheet the person closed raises no toast: the act never ran, and nothing failed.
  if (!answer.ok && answer.closed === true) return;
  const line = answerLine(answer, done);
  const word = answer.ok ? (answer.done ?? done) : done;
  // A done act's text other than its own word is its note.
  appToast(line.tone, line.text, line.tone !== "success" || line.text !== word);
}

const region = tv({
  base: "pointer-events-none fixed inset-x-0 z-50 flex flex-col items-center gap-2 px-4",
  variants: {
    // 12 px under the band or the strip, centred over the content, by the frames' measures `tokens.css`
    // declares on the root: on desktop the rail frame's content starts after the rail, the classic frame's under
    // its header. Its edge moves with the rail as the rail folds, on the motion the frame's grid takes.
    frame: {
      rail: "top-[calc(var(--rail-band)+0.75rem)] data-collapsed:[--rail-width:var(--rail-width-collapsed)] lg:top-[calc(var(--rail-strip)+0.75rem)] lg:left-(--rail-width) lg:transition-[left] lg:duration-(--motion-in)",
      classic: "top-[calc(var(--classic-header)+0.75rem)]",
    },
  },
});

/**
 * Where toasts appear: top centre under the band or the strip. The frame mounts it once. A toast fades
 * in on the overlay token and leaves without a fade.
 *
 * React Aria draws the region in the document's body, a top-level node that an open modal or menu leaves
 * visible, so the rail's collapsed state, which the frame's root carries, reaches it through the rail's
 * context instead.
 */
export function ToastRegion({ frame }: { frame: "rail" | "classic" }) {
  const collapsed = useRailCollapsed();
  return (
    <AriaToastRegion
      queue={queue}
      data-kit-focus
      data-collapsed={collapsed || undefined}
      className={region({ frame })}>
      {({ toast }) => (
        <AriaToast
          toast={toast}
          data-kit-focus="ring"
          className="pointer-events-auto flex min-h-11 max-w-full items-center gap-3 rounded-xl border border-border bg-bg-overlay px-4 py-3 text-sm font-medium text-pretty text-fg shadow-dialog transition-opacity duration-(--motion-in) starting:opacity-0">
          <span className={TONE_CLASSES[toast.content.tone]}>
            <Icon
              glyph={GLYPH[toast.content.tone]}
              size={16}
            />
          </span>
          <ToastContent className="min-w-0">
            <Text slot="title">{toast.content.title}</Text>
          </ToastContent>
          {/* After the content, so a screen reader says the outcome before the button, as React Aria places it. Pulled
              into the padding by its glyph's inset, so the toast keeps its height and the glyph stands as far from the
              right edge as the tone's glyph from the left. */}
          <div className="-my-1.5 -me-2 pointer-coarse:-my-2.5 pointer-coarse:-me-3">
            <Button
              icon="close"
              label={COPY.shared.close}
              slot="close"
            />
          </div>
        </AriaToast>
      )}
    </AriaToastRegion>
  );
}
