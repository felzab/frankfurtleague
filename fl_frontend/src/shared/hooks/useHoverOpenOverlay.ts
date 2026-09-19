"use client";

import { useEffect, useReducer, useRef, useState } from "react";

import type { PointerEvent as ReactPointerEvent } from "react";

/** Pointer slack around the trigger and the panel — wide enough to cross the gap between them. */
const HOVER_SLACK_PX = 12;

const isNear = (el: HTMLElement | null, x: number, y: number): boolean => {
  if (el === null) return false;
  const r = el.getBoundingClientRect();
  return x >= r.left - HOVER_SLACK_PX && x <= r.right + HOVER_SLACK_PX && y >= r.top - HOVER_SLACK_PX && y <= r.bottom + HOVER_SLACK_PX;
};

type Overlay = {
  isOpen: boolean;
  /** Outlives the close: the panel animates out as what it opened as, and a dialog mounted for that exit takes focus. */
  openedBy: "hover" | "press";
  /**
   * A dialog's underlay leaving from under a resting pointer fires an enter and no move, and a hand on a mouse is never
   * still: either would bring back a panel somebody has just dismissed (WCAG 1.4.13).
   */
  awaitsLeave: boolean;
};

type OverlayEvent = "press" | "dismiss" | "pointerOnTrigger" | "escape" | "pointerOutOfReach" | "pointerOffTrigger";

export const CLOSED_OVERLAY: Overlay = { isOpen: false, openedBy: "press", awaitsLeave: false };

export function nextOverlay(current: Overlay, event: OverlayEvent): Overlay {
  switch (event) {
    case "press":
      return { isOpen: true, openedBy: "press", awaitsLeave: false };
    case "dismiss":
      return { ...current, isOpen: false, awaitsLeave: current.isOpen };
    case "pointerOnTrigger":
      // Never over a press: a move landing between a click and the underlay it mounts would demote the dialog it opened.
      return current.isOpen || current.awaitsLeave ? current : { isOpen: true, openedBy: "hover", awaitsLeave: false };
    case "escape":
      return { ...current, isOpen: false, awaitsLeave: true };
    case "pointerOutOfReach":
      return { ...current, isOpen: false };
    case "pointerOffTrigger":
      return current.awaitsLeave ? { ...current, awaitsLeave: false } : current;
  }
}

/**
 * The hover half of an overlay that also opens on press, react-aria's tooltip never opening on a tap. **Hover closes on
 * pointer position, never on an enter/leave pair**: a leave fires while the pointer crosses the gap to the panel.
 */
export function useHoverOpenOverlay(): {
  /** Goes to `Popover.Content`'s `isOpen`, and to whatever styles the trigger as open: the panel stands either way. */
  isOpen: boolean;
  /**
   * **Goes to the popover root's `isOpen`, never this hook's `isOpen`.** The root toggles on a trigger press, so a
   * root told a hover-opened panel is open would close it under the press that should have opened the dialog.
   */
  isDialogOpen: boolean;
  /**
   * **The caller renders a hover-opened panel non-modal and outside any dialog.** A dialog takes focus on mount and a
   * modal popover makes the page `inert`, so a pointer merely crossing the trigger would take the field being typed in.
   */
  isOpenedByHover: boolean;
  /**
   * **Goes to `Popover.Content`'s `key`**, remounting it when a press takes a hover-opened panel over: react-aria's
   * focus scope records where to hand focus back as it mounts, which for a hover was wherever somebody was typing.
   */
  panelKey: Overlay["openedBy"];
  /** Goes to every `onOpenChange` the popover takes: an open is always the dialog, and every close lands here. */
  onOpenChange: (open: boolean) => void;
  /**
   * **Goes to the trigger's `onPointerMove`, never an enter**, which a browser also fires when an overlay leaves from
   * under a pointer that never moved. It reads the trigger element off the event.
   */
  openFromHover: (event: ReactPointerEvent) => void;
  /** Goes to the panel's `ref`, so the pointer may cross into the panel without closing it. */
  captureDialog: (element: HTMLElement | null) => void;
} {
  const [overlay, dispatch] = useReducer(nextOverlay, CLOSED_OVERLAY);

  const [trigger, setTrigger] = useState<HTMLElement | null>(null);
  const [panel, setPanel] = useState<HTMLElement | null>(null);

  // The move the trigger heard last. The window's listener meets that same event as it bubbles, which is how it tells a
  // move on the trigger from one off it without measuring anything.
  const moveOnTrigger = useRef<Event | null>(null);

  const isHovering = overlay.isOpen && overlay.openedBy === "hover";

  useEffect(() => {
    if (!isHovering) return;

    const handleMove = (event: PointerEvent) => {
      if (!isNear(trigger, event.clientX, event.clientY) && !isNear(panel, event.clientX, event.clientY)) dispatch("pointerOutOfReach");
    };

    // On the window: focus never enters a hover-opened panel, so react-aria's Escape on the panel itself never hears it.
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") dispatch("escape");
    };

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("keydown", handleKey);
    };
  }, [isHovering, trigger, panel]);

  useEffect(() => {
    if (!overlay.awaitsLeave) return;

    const release = (event: PointerEvent) => {
      if (event !== moveOnTrigger.current) dispatch("pointerOffTrigger");
    };

    window.addEventListener("pointermove", release);
    return () => window.removeEventListener("pointermove", release);
  }, [overlay.awaitsLeave]);

  return {
    isOpen: overlay.isOpen,
    isDialogOpen: overlay.isOpen && overlay.openedBy === "press",
    isOpenedByHover: overlay.openedBy === "hover",
    panelKey: overlay.openedBy,
    captureDialog: setPanel,
    onOpenChange: (open: boolean) => dispatch(open ? "press" : "dismiss"),
    openFromHover: (event: ReactPointerEvent) => {
      // A finger has no hover, and one dragged across the trigger is the page scrolling.
      if (event.pointerType === "touch") return;

      moveOnTrigger.current = event.nativeEvent;
      setTrigger(event.currentTarget as HTMLElement);
      dispatch("pointerOnTrigger");
    },
  };
}
