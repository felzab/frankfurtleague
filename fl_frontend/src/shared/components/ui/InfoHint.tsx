"use client";

import { useEffect, useRef, useState } from "react";

import { CircleInfo } from "@gravity-ui/icons";

import { Popover } from "@heroui/react";

import { overlayPanel } from "./overlayPanel";

import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";

/** Pointer slack around the trigger and the dialog — wide enough to cross the 8px gap between them. */
const HOVER_SLACK_PX = 12;

const isNear = (el: HTMLElement | null, x: number, y: number): boolean => {
  if (el === null) return false;
  const r = el.getBoundingClientRect();
  return x >= r.left - HOVER_SLACK_PX && x <= r.right + HOVER_SLACK_PX && y >= r.top - HOVER_SLACK_PX && y <= r.bottom + HOVER_SLACK_PX;
};

/**
 * A short explanation of a surface, behind a small icon beside its title — the rich-content sibling
 * of `IconTooltip`.
 *
 * **A popover rather than a tooltip, because of touch**: react-aria's tooltip opens on hover and
 * focus but deliberately never on tap, so on a phone it is unreachable. A popover opens on press;
 * the hover half is added for pointer users.
 *
 * **Hover closes on pointer position, not on enter/leave pairs.** Whatever the overlay machinery
 * puts under the cursor while opening steals the hover and fires a leave, and a leave-driven close
 * re-fires an enter — the oscillation two earlier attempts hit. So entering the trigger opens the
 * hint and sets `isHovering`; while it is set, one effect-owned `mousemove` listener closes the hint
 * the moment the pointer is inside neither the trigger's nor the dialog's rectangle. The effect's
 * cleanup is the whole lifecycle: re-arm, unmount and press-open all fall out of it.
 *
 * `children` is a node: a hint long enough to need this surface needs structure (a lead, a list, a
 * bolded term), and the dialog styles those tags. `trigger` swaps the default icon — the change
 * list's operation icons ride the same mechanism.
 */
export function InfoHint({ label, children, trigger }: { label: string; children: ReactNode; trigger?: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isHovering, setIsHovering] = useState(false);

  const triggerRef = useRef<HTMLElement | null>(null);
  const dialogRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isHovering) return;

    const handleMove = (event: MouseEvent) => {
      if (isNear(triggerRef.current, event.clientX, event.clientY) || isNear(dialogRef.current, event.clientX, event.clientY)) return;
      setIsHovering(false);
      setIsOpen(false);
    };

    window.addEventListener("mousemove", handleMove);
    return () => window.removeEventListener("mousemove", handleMove);
  }, [isHovering]);

  const openFromHover = (event: ReactMouseEvent) => {
    triggerRef.current = event.currentTarget as HTMLElement;
    setIsHovering(true);
    setIsOpen(true);
  };

  return (
    <Popover
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) setIsHovering(false);
        setIsOpen(open);
      }}>
      {/* `cursor-help` is the affordance: it says "this holds an explanation" where a bare icon
          does not.

          The default icon is an INLINE glyph, not a flex sibling: it lives inside the heading's own
          text flow. Centring in a flex row can never look right, because the text's visual mass
          sits above its line box's centre (owner's diagnosis, ninth round). Everything below is in
          font-relative units — no pixel anywhere — and the vertical offset is DERIVED from the icon
          size, so any text size and any icon size stay aligned by construction: a box of height H
          sitting with its bottom V above the baseline has its centre at V + H/2, and
          `0.3em − H/2` pins that centre to 0.3em above the baseline — a shade under the x-height
          band's middle (0.375em), which is where the owner's eye settled it: the icon's bottom then
          reaches the text's descender depth, so the two share a bottom edge. To resize the icon,
          change `--hint-icon-size` alone; the offset follows. To retune the optical height, the
          0.3em constant is the only knob. */}
      <Popover.Trigger
        aria-label={label}
        className={
          trigger
            ? "hover:bg-muted -m-0.5 inline-flex shrink-0 cursor-help items-center justify-center rounded-md p-0.5 transition-colors"
            : "text-foreground-muted hover:text-brand ms-1.5 inline-flex shrink-0 cursor-help align-[calc(0.3em-var(--hint-icon-size)/2)] transition-colors [--hint-icon-size:1em]"
        }
        onMouseEnter={openFromHover}>
        {trigger ?? <CircleInfo className="h-(--hint-icon-size) w-(--hint-icon-size)" />}
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
