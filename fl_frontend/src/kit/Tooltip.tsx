"use client";

import { Tooltip as AriaTooltip, TooltipTrigger } from "react-aria-components/Tooltip";

import type { Copy } from "@/core/copy";
import type { ReactElement } from "react";

/**
 * The name of an icon-only control, shown above it on the hairline surface. React Aria's own delays
 * stand: the first tooltip waits, the next ones open at once. Rendered by `Button` alone, from its
 * required label.
 */
export function Tooltip({ label, children }: { label: Copy; children: ReactElement }) {
  return (
    <TooltipTrigger>
      {children}
      <AriaTooltip
        data-kit-focus
        placement="top"
        offset={4}
        className="rounded-md border border-border bg-bg px-2 py-1 text-xs font-medium whitespace-nowrap text-fg shadow-menu transition-opacity duration-(--motion-in) data-entering:opacity-0 data-exiting:opacity-0 data-exiting:duration-(--motion-out)">
        {label}
      </AriaTooltip>
    </TooltipTrigger>
  );
}
