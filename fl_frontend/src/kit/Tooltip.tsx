"use client";

import { Tooltip as AriaTooltip, TooltipTrigger } from "react-aria-components/Tooltip";

import type { Copy } from "@/core/copy";
import type { ReactElement } from "react";
import type { HeldOpen } from "./useOpenUntilHidden";

/**
 * The name of an icon-only control, or the reason a locked act cannot run, shown above it on the hairline surface, or
 * at its end for an entry of the collapsed rail, where one above would cover the entry before it. A sentence wraps at
 * 320 px. The first tooltip waits 500 ms, a third of React Aria's default, and the next ones open at once. It stands
 * in React Aria's portal, so a card's `overflow-hidden` never cuts it. Rendered by `Button` for an icon-only button and
 * a locked act, by `ChoiceButtons` for a glyph segment, by the rail for a collapsed entry and by `Link`'s icon placement
 * for a glyph link, each from its required label; disabled while the control shows its own words.
 */
export function Tooltip({
  label,
  placement = "top",
  isDisabled = false,
  held,
  children,
}: {
  label: Copy;
  placement?: "top" | "top start" | "top end" | "end";
  isDisabled?: boolean;
  /** The open state where a press opens it too, as a locked act's: a press then keeps it open, by React Aria's `shouldCloseOnPress`. */
  held?: HeldOpen;
  children: ReactElement;
}) {
  return (
    <TooltipTrigger
      delay={500}
      isDisabled={isDisabled}
      shouldCloseOnPress={held === undefined}
      {...held}>
      {children}
      <AriaTooltip
        data-kit-focus
        placement={placement}
        // 4 px over a control; past a rail entry's end, 4 px beyond the rail's 12-px inset and its edge.
        offset={placement === "end" ? 16 : 4}
        className="w-max max-w-popover rounded-md border border-border bg-bg-overlay px-2 py-1 text-xs font-medium text-fg shadow-menu transition-opacity duration-(--motion-in) data-entering:opacity-0 data-exiting:opacity-0 data-exiting:duration-(--motion-out)">
        {label}
      </AriaTooltip>
    </TooltipTrigger>
  );
}
