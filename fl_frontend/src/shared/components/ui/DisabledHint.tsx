"use client";

import { Popover } from "@heroui/react";

import { useHoverOpenOverlay } from "@/shared/hooks/useHoverOpenOverlay";

import { HINT_SURFACE } from "./hintSurface";

import type { ReactNode } from "react";

/**
 * The reason a control is disabled, on the control itself — opening on hover with a pointer and on a
 * tap with a finger.
 *
 * **On a WRAPPER, never on the control.** A disabled form control dispatches no pointer event at all,
 * and the event does not reach an ancestor either, so nothing mounted on the button can ever fire.
 * The wrapper is the hit target instead, which needs the control inside it to be pointer-transparent:
 * `formButton`'s base and `RowActions`' shape both carry `disabled:pointer-events-none` for this.
 *
 * **A popover rather than a tooltip, and that is forced.** React Aria's `useHover` discards a
 * touch-originated pointer and `useTooltipTrigger` takes `trigger: "hover" | "focus"` only — its
 * `onPointerDown` CLOSES — so a tooltip is unreachable on a phone, which is `InfoHint`'s reason too.
 * The popover carries press, Escape, light dismiss and focus return; `useHoverOpenOverlay` adds hover,
 * which is why no press handler is written here.
 *
 * **The wrapper is the keyboard's answer.** A natively disabled button is out of the tab order
 * entirely, so a hover-only hint reaches nobody navigating by keyboard. `Popover.Trigger` is a
 * focusable `role="button"`, so the tab stop the disabled control vacated is taken by the thing that
 * explains it, and `reason` is what that stop announces — one string rather than a second one that
 * could drift from it. Nesting is legal precisely because the control inside is disabled and so is
 * not focusable itself.
 *
 * **`reason` null renders a plain wrapper**, so a live control keeps its own tab stop and gains no
 * overlay, while the box the layout is built around stays put across the two states.
 */
export function DisabledHint({
  reason,
  className,
  placement = "top",
  children,
}: {
  /** The refusal, or null while the control is live. It is both the panel's text and the tab stop's name. */
  reason: string | null;
  /** The layout classes the wrapped control would otherwise carry; the wrapper is the flex child now. */
  className?: string;
  placement?: "top" | "right" | "bottom" | "left";
  children: ReactNode;
}) {
  const { isOpen, onOpenChange, openFromHover, captureDialog } = useHoverOpenOverlay();

  // `inline-block` is what `.popover__trigger` resolves to, so the box is the same in both states and
  // a flex parent lays the control out identically whichever branch rendered it.
  if (reason === null) return <div className={`inline-block ${className ?? ""}`}>{children}</div>;

  return (
    <Popover
      isOpen={isOpen}
      onOpenChange={onOpenChange}>
      {/* `cursor-help` is the affordance `InfoHint` uses for the same promise: this holds an
          explanation. It reaches the pointer because the control below it does not. */}
      <Popover.Trigger
        aria-label={reason}
        className={`cursor-help ${className ?? ""}`}
        onMouseEnter={openFromHover}>
        {children}
      </Popover.Trigger>

      <Popover.Content
        placement={placement}
        offset={8}>
        <Popover.Dialog
          ref={captureDialog}
          className={`${HINT_SURFACE} text-foreground leading-normal font-medium`}>
          {reason}
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  );
}
