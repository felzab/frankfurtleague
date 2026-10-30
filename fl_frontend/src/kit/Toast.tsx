"use client";

import {
  UNSTABLE_Toast as AriaToast,
  UNSTABLE_ToastRegion as AriaToastRegion,
  Text,
  UNSTABLE_ToastContent as ToastContent,
  UNSTABLE_ToastQueue as ToastQueue,
} from "react-aria-components/Toast";

import { Icon } from "./Icon";
import { useRailCollapsed } from "./RailState";
import { tv } from "./tv";

import type { Copy } from "@/core/copy";

// React Aria exports its toast under `UNSTABLE_` names alone: the API may change in a minor release.
type ToastContentData = { tone: "success" | "danger"; title: Copy };

const queue = new ToastQueue<ToastContentData>();

// React Aria's documented floor for a toast that closes itself, so every reader has time for it.
const TIMEOUT_MS = 5000;

/**
 * Reports an outcome that has no place on the page: a title alone, from the catalogue's toast titles.
 * The one way to raise a toast.
 */
export function appToast(tone: "success" | "danger", title: Copy) {
  queue.add({ tone, title }, { timeout: TIMEOUT_MS });
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
          className="pointer-events-auto flex min-h-11 max-w-full items-center gap-3 rounded-xl border border-border bg-bg px-4 py-3 text-sm font-medium whitespace-nowrap text-fg shadow-dialog transition-opacity duration-(--motion-in) starting:opacity-0">
          <span className={toast.content.tone === "success" ? "text-success" : "text-danger"}>
            <Icon
              glyph={toast.content.tone === "success" ? "erledigt" : "error"}
              size={16}
            />
          </span>
          <ToastContent className="min-w-0">
            <Text slot="title">{toast.content.title}</Text>
          </ToastContent>
        </AriaToast>
      )}
    </AriaToastRegion>
  );
}
