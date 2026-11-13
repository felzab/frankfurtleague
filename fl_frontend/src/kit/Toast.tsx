"use client";

import {
  UNSTABLE_Toast as AriaToast,
  UNSTABLE_ToastRegion as AriaToastRegion,
  Text,
  UNSTABLE_ToastContent as ToastContent,
  UNSTABLE_ToastQueue as ToastQueue,
} from "react-aria-components/Toast";

import { COPY } from "@/core/copy";

import { Button } from "./Button";
import { Icon } from "./Icon";
import { useRailCollapsed } from "./RailState";
import { tv } from "./tv";

import type { ActionAnswer } from "@/core/action";
import type { Copy } from "@/core/copy";

// React Aria exports its toast under `UNSTABLE_` names alone: the API may change in a minor release.
type ToastContentData = { tone: Tone; title: Copy };

/** Done, partly done (an answer's `warn`), or not done. */
type Tone = "success" | "warn" | "danger";

/** Each tone's hue, as a status card marks the same outcome. */
const TONE_CLASSES: Readonly<Record<Tone, string>> = { success: "text-success", warn: "text-warn", danger: "text-danger" };

/** Each tone's glyph, a status card's. */
const GLYPH = { success: "done", warn: "warning", danger: "error" } as const;

const queue = new ToastQueue<ToastContentData>();

// React Aria's documented floor for a toast that closes itself, so every reader has time for it.
const TIMEOUT_MS = 5000;

/**
 * Reports an outcome that has no place on the page: a title alone, from the catalogue's toast titles.
 * The one way to raise a toast. A done act's toast closes itself; a refusal or a partial outcome stands until it is
 * closed, since the page says it nowhere else (React Aria's Toast closes by itself only what is not critical or may be
 * found elsewhere).
 */
export function appToast(tone: Tone, title: Copy) {
  queue.add({ tone, title }, tone === "success" ? { timeout: TIMEOUT_MS } : undefined);
}

/**
 * An act's answer as its toast: `done` where it was done, or the line the answer brings, its note or its reason, in
 * the warn tone where it partly happened (`ActionAnswer`'s `warn`), as a form's status line reads the same answer.
 */
export function toastAnswer(answer: ActionAnswer<unknown>, done: Copy) {
  if (answer.ok) appToast(answer.warn === true ? "warn" : "success", answer.note ?? done);
  else appToast(answer.warn === true ? "warn" : "danger", answer.reason ?? COPY.shared.toast.failure);
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
