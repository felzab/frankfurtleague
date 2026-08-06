"use client";

import { useEffect, useRef, useState } from "react";

import { CircleInfo } from "@gravity-ui/icons";

import { Popover } from "@heroui/react";

import { overlayPanel } from "./overlayPanel";

import type { ReactNode } from "react";

/**
 * A short explanation of what a section is for, behind a small icon beside its title.
 *
 * **A popover rather than `IconTooltip`, and the reason is touch.** react-aria's tooltip opens on hover
 * and on keyboard focus and deliberately does not open on tap — a tooltip is a pointer affordance, and
 * on a phone it is simply unreachable. A popover opens on press, which covers touch, and the hover
 * handlers below add hover on top: "hover on desktop, tap on mobile", which is what an explanation
 * beside a heading has to do to be worth putting there.
 *
 * **Hover works on intent, not on raw enter/leave.** Leaving the trigger only SCHEDULES the close, and
 * entering either the trigger or the popover cancels it. Without the grace period, the popover's own
 * appearance under the pointer fired `mouseleave` on the trigger, which closed it, which fired
 * `mouseenter`, which opened it — an open/close oscillation the owner saw as a flickering box and a
 * cursor flipping between pointer and default (fourth review).
 *
 * **It exists so the fields underneath can stop explaining themselves.** `children` is a node, not a
 * string, on purpose: a hint long enough to need this surface is long enough to need structure — a
 * lead line, a list, a bolded term — and one flat paragraph in a small box is what the owner rejected.
 * The dialog styles the text; callers bring `<p>`, `<ul>` and `<strong>`.
 *
 * `Popover.Trigger` IS the control and no `<button>` goes inside it: it renders a `div role="button"`
 * wrapped in react-aria's `Pressable`, which is focusable in its own right, so nesting a real button
 * gives two tab stops with two differently-shaped outlines — the trap `TeamPopoverMenu` documents.
 * The trigger box is exactly the icon's size (hit area grown by padding carved out of a negative
 * margin), so `items-center` rows centre the GLYPH against the neighbouring text instead of centring
 * a taller invisible box and leaving the icon riding high.
 */
export function InfoHint({ label, children }: { label: string; children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);

  // The grace period between leaving the trigger and the popover actually closing. Long enough to
  // cross the 8px offset gap into the dialog, short enough that the hint never feels stuck open.
  const closeTimer = useRef<number | null>(null);

  const cancelScheduledClose = () => {
    if (closeTimer.current !== null) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };

  const openNow = () => {
    cancelScheduledClose();
    setIsOpen(true);
  };

  const scheduleClose = () => {
    cancelScheduledClose();
    closeTimer.current = window.setTimeout(() => setIsOpen(false), 150);
  };

  // The timer must not outlive the component — a close firing after unmount is a setState on nothing.
  useEffect(() => cancelScheduledClose, []);

  return (
    <Popover
      isOpen={isOpen}
      onOpenChange={setIsOpen}>
      <Popover.Trigger
        aria-label={label}
        className="text-foreground-muted hover:text-brand -m-1.5 box-content inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-full p-1.5 transition-colors"
        onMouseEnter={openNow}
        onMouseLeave={scheduleClose}>
        <CircleInfo className="size-5" />
      </Popover.Trigger>

      <Popover.Content
        placement="top"
        offset={8}>
        <Popover.Dialog
          onMouseEnter={cancelScheduledClose}
          onMouseLeave={scheduleClose}
          className={`${overlayPanel()} fluid-xs text-foreground [&_strong]:text-foreground flex w-max max-w-88 flex-col gap-y-2 p-4 leading-normal font-medium outline-none [&_strong]:font-bold [&_ul]:flex [&_ul]:flex-col [&_ul]:gap-y-1.5`}>
          {children}
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  );
}
