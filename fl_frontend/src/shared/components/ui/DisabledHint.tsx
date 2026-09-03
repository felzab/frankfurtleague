"use client";

import { Popover } from "@heroui/react";

import { useHoverOpenOverlay } from "@/shared/hooks/useHoverOpenOverlay";

import { HINT_SURFACE } from "./hintSurface";

import type { ReactNode } from "react";

/**
 * On a wrapper, never on the control, which `Hint`'s `refusal` mode carries in full (COR-2). This one is what the
 * call sites outside that mode's reach still render.
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
      {/* `cursor-auto` for `hintTrigger.ts`'s reason, which this wrapper shares. The disabled control inside declares
          `not-allowed`, but `status-disabled` also makes it `pointer-events: none`, so that value never reaches the pointer. */}
      <Popover.Trigger
        aria-label={reason}
        className={`cursor-auto ${className ?? ""}`}
        onMouseEnter={openFromHover}>
        {children}
      </Popover.Trigger>

      {/* The outer box is cleared for `Hint.tsx`'s reason: HeroUI's `.popover` would ring the panel's own corners. */}
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
