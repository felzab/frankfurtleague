"use client";

import { useEffect, useState } from "react";

import type { MouseEvent as ReactMouseEvent } from "react";

/** Pointer slack around the trigger and the dialog — wide enough to cross the gap between them. */
const HOVER_SLACK_PX = 12;

const isNear = (el: HTMLElement | null, x: number, y: number): boolean => {
  if (el === null) return false;
  const r = el.getBoundingClientRect();
  return x >= r.left - HOVER_SLACK_PX && x <= r.right + HOVER_SLACK_PX && y >= r.top - HOVER_SLACK_PX && y <= r.bottom + HOVER_SLACK_PX;
};

/**
 * The hover half of an overlay that also opens on press, react-aria's tooltip never opening on a tap. **Hover closes on
 * pointer position, never on an enter/leave pair**: the opening panel steals the hover, and a leave-close re-enters.
 */
export function useHoverOpenOverlay(): {
  isOpen: boolean;
  /** Goes to the popover root's `onOpenChange`, so a press, Escape and a light dismiss all land here. */
  onOpenChange: (open: boolean) => void;
  /** Goes to the trigger's `onMouseEnter`; it reads the trigger element off the event. */
  openFromHover: (event: ReactMouseEvent) => void;
  /** Goes to the dialog's `ref`, so the pointer may cross into the panel without closing it. */
  captureDialog: (element: HTMLElement | null) => void;
} {
  const [isOpen, setIsOpen] = useState(false);
  const [isHovering, setIsHovering] = useState(false);

  const [trigger, setTrigger] = useState<HTMLElement | null>(null);
  const [dialog, setDialog] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (!isHovering) return;

    const handleMove = (event: MouseEvent) => {
      if (isNear(trigger, event.clientX, event.clientY) || isNear(dialog, event.clientX, event.clientY)) return;
      setIsHovering(false);
      setIsOpen(false);
    };

    window.addEventListener("mousemove", handleMove);
    return () => window.removeEventListener("mousemove", handleMove);
  }, [isHovering, trigger, dialog]);

  return {
    isOpen,
    captureDialog: setDialog,
    onOpenChange: (open: boolean) => {
      if (!open) setIsHovering(false);
      setIsOpen(open);
    },
    openFromHover: (event: ReactMouseEvent) => {
      setTrigger(event.currentTarget as HTMLElement);
      setIsHovering(true);
      setIsOpen(true);
    },
  };
}
