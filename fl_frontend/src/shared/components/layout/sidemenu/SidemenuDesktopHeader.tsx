"use client";

import { BrandLink } from "../../ui/BrandLink";
import { IconTooltip } from "../../ui/IconTooltip";

export default function SidemenuDesktopHeader({ isDesktopCollapsed }: { isDesktopCollapsed: boolean }) {
  return (
    <div
      className={`border-border hidden h-14 shrink-0 items-center border-b transition-[padding] duration-300 lg:flex ${
        isDesktopCollapsed ? "justify-center" : "justify-start px-4"
      }`}>
      <IconTooltip
        label="Zur öffentlichen Website"
        placement="right"
        isEnabled={isDesktopCollapsed}>
        <BrandLink
          title="Zur öffentlichen Website"
          hideName={isDesktopCollapsed}
        />
      </IconTooltip>
    </div>
  );
}
