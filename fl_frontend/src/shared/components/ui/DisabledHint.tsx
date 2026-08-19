"use client";

import { Popover } from "@heroui/react";

import { useHoverOpenOverlay } from "@/shared/hooks/useHoverOpenOverlay";

import { HINT_SURFACE } from "./hintSurface";

import type { ReactNode } from "react";

/**
 * **On a wrapper, never on the control.** A disabled control dispatches no pointer event and none reaches an ancestor,
 * so the wrapper is the hit target — and the tab stop, a disabled button being out of the tab order entirely.
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

  // `inline-block` is what `.popover__trigger` resolves to, so a flex parent lays both branches out identically.
  if (reason === null) return <div className={`inline-block ${className ?? ""}`}>{children}</div>;

  return (
    <Popover
      isOpen={isOpen}
      onOpenChange={onOpenChange}>
      {/* `cursor-help`, as `InfoHint` uses for the same promise. It reaches the pointer because the control does not. */}
      <Popover.Trigger
        aria-label={reason}
        className={`cursor-help ${className ?? ""}`}
        onMouseEnter={openFromHover}>
        {children}
      </Popover.Trigger>

      {/* The outer box is cleared: HeroUI's `.popover` draws a fill, a shadow and a larger radius, which would ring
          the panel's own corners. The panel below is the one surface, shared with `IconTooltip`. */}
      <Popover.Content
        placement={placement}
        offset={8}
        className="bg-transparent shadow-none">
        <Popover.Dialog
          ref={captureDialog}
          className={`${HINT_SURFACE} text-foreground leading-normal font-medium`}>
          {reason}
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  );
}
