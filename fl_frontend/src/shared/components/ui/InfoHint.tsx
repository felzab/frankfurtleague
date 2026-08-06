"use client";

import { useEffect, useRef, useState } from "react";

import { CircleInfo } from "@gravity-ui/icons";

import { Popover } from "@heroui/react";

import { overlayPanel } from "./overlayPanel";

import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";

/** How far outside the trigger and the dialog the pointer may drift before a hover-open hint
 * closes. Wide enough to cross the 8px placement gap between the two without a detour. */
const HOVER_SLACK_PX = 12;

const withinRect = (rect: DOMRect, x: number, y: number): boolean =>
  x >= rect.left - HOVER_SLACK_PX && x <= rect.right + HOVER_SLACK_PX && y >= rect.top - HOVER_SLACK_PX && y <= rect.bottom + HOVER_SLACK_PX;

/**
 * A short explanation of what a section is for, behind a small icon beside its title.
 *
 * **A popover rather than `IconTooltip`, and the reason is touch.** react-aria's tooltip opens on hover
 * and on keyboard focus and deliberately does not open on tap — a tooltip is a pointer affordance, and
 * on a phone it is simply unreachable. A popover opens on press, which covers touch, and the hover
 * handling below adds hover on top: "hover on desktop, tap on mobile".
 *
 * **Hover is tracked globally, not by enter/leave pairs.** Two attempts keyed on the trigger's own
 * `mouseenter`/`mouseleave` both oscillated: whatever the overlay machinery puts under the pointer at
 * the moment the popover opens — the portal, the animating dialog — steals the hover, fires a leave,
 * and the close re-fires an enter, which the owner saw twice as a flickering box and a cursor flipping
 * between pointer and default. So entering the trigger opens the hint and arms one `mousemove`
 * listener on the window; the hint stays open exactly while the pointer is inside the trigger's or
 * the dialog's rectangle (plus slack), whatever element is technically hovered, and closes the moment
 * it is inside neither. No enter/leave pair anywhere, so there is nothing left to oscillate.
 *
 * **It exists so the fields underneath can stop explaining themselves.** `children` is a node, not a
 * string, on purpose: a hint long enough to need this surface is long enough to need structure — a
 * lead line, a list, a bolded term. The dialog styles the text; callers bring `<p>`, `<ul>`,
 * `<strong>`.
 *
 * `Popover.Trigger` IS the control and no `<button>` goes inside it: it renders a `div role="button"`
 * wrapped in react-aria's `Pressable`, which is focusable in its own right. The trigger box is
 * EXACTLY the icon — no padding, no negative-margin hit-area tricks: those made the painted box
 * larger than the layout box and read as uneven space around the glyph (owner, fifth review). In an
 * `items-center` row the 20px box centres against the neighbouring text to the pixel.
 */
export function InfoHint({
  label,
  children,
  trigger,
}: {
  label: string;
  children: ReactNode;
  /**
   * Replaces the default info icon as the press-and-hover target — the change list's operation
   * icons use this, so one hover mechanism serves every hint on the page instead of each surface
   * growing its own (and its own oscillation bug).
   */
  trigger?: ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(false);

  const triggerRef = useRef<HTMLElement | null>(null);
  const dialogRef = useRef<HTMLElement | null>(null);
  const stopTrackingRef = useRef<(() => void) | null>(null);

  const stopTracking = () => {
    stopTrackingRef.current?.();
    stopTrackingRef.current = null;
  };

  // One listener per hover-open, removed on close or unmount. Reading the rects per move is cheap at
  // pointer speed and means the tracked areas follow the dialog wherever placement puts it.
  const startTracking = () => {
    if (stopTrackingRef.current !== null) return;

    const handleMove = (event: MouseEvent) => {
      const overTrigger = triggerRef.current !== null && withinRect(triggerRef.current.getBoundingClientRect(), event.clientX, event.clientY);
      const overDialog = dialogRef.current !== null && withinRect(dialogRef.current.getBoundingClientRect(), event.clientX, event.clientY);

      if (!overTrigger && !overDialog) {
        stopTracking();
        setIsOpen(false);
      }
    };

    window.addEventListener("mousemove", handleMove);
    stopTrackingRef.current = () => window.removeEventListener("mousemove", handleMove);
  };

  useEffect(() => stopTracking, []);

  const openFromHover = (event: ReactMouseEvent) => {
    triggerRef.current = event.currentTarget as HTMLElement;
    setIsOpen(true);
    startTracking();
  };

  return (
    <Popover
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) stopTracking();
        setIsOpen(open);
      }}>
      {/* `cursor-help` on both shapes — the cursor is what says "this holds an explanation", which
          a bare icon otherwise does not (owner, seventh review). The custom-trigger shape adds a
          hover fill for the same reason.

          `self-stretch items-end`, and NOT baseline alignment: the icon's bottom pixel must sit on
          the neighbouring text's bottom (owner, seventh and eighth reviews), and a baseline
          approach depends on the loaded font's metrics — it measured true under the audit pane's
          fallback font and rode HIGH under the real one. Stretching the trigger to the text row's
          own height and pinning the icon to the box's end is pure geometry: no font can move it. */}
      <Popover.Trigger
        aria-label={label}
        className={
          trigger
            ? "hover:bg-muted inline-flex shrink-0 cursor-help items-end justify-center self-stretch rounded-md transition-colors"
            : "text-foreground-muted hover:text-brand inline-flex w-5 shrink-0 cursor-help items-end justify-center self-stretch transition-colors"
        }
        onMouseEnter={openFromHover}>
        {trigger ?? <CircleInfo className="size-5" />}
      </Popover.Trigger>

      <Popover.Content
        placement="top"
        offset={8}>
        <Popover.Dialog
          ref={dialogRef}
          className={`${overlayPanel()} fluid-xs text-foreground [&_strong]:text-foreground flex w-max max-w-88 flex-col gap-y-2 p-4 leading-normal font-medium outline-none [&_strong]:font-bold [&_ul]:flex [&_ul]:flex-col [&_ul]:gap-y-1.5`}>
          {children}
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  );
}
