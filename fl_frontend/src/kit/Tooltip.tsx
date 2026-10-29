"use client";

import { Tooltip as AriaTooltip, TooltipTrigger } from "react-aria-components/Tooltip";

import type { Copy } from "@/core/copy";
import type { ReactElement } from "react";

/**
 * The name of an icon-only control, shown above it on the hairline surface, or at its end for an entry of
 * the collapsed rail, where one above would cover the entry before it. React Aria's own delays stand: the
 * first tooltip waits, the next ones open at once. Rendered by `Button` for an icon-only button, by
 * `ChoiceButtons` for a glyph segment and by the rail for a collapsed entry, each from its required label;
 * disabled while the control shows its own words.
 */
export function Tooltip({
  label,
  placement = "top",
  isDisabled = false,
  children,
}: {
  label: Copy;
  placement?: "top" | "end";
  isDisabled?: boolean;
  children: ReactElement;
}) {
  return (
    <TooltipTrigger isDisabled={isDisabled}>
      {children}
      <AriaTooltip
        data-kit-focus
        placement={placement}
        // 4 px over a control; past a rail entry's end, 4 px beyond the rail's 12-px inset and its edge.
        offset={placement === "end" ? 16 : 4}
        className="rounded-md border border-border bg-bg px-2 py-1 text-xs font-medium whitespace-nowrap text-fg shadow-menu transition-opacity duration-(--motion-in) data-entering:opacity-0 data-exiting:opacity-0 data-exiting:duration-(--motion-out)">
        {label}
      </AriaTooltip>
    </TooltipTrigger>
  );
}
