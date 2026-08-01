"use client";

import { BrandLink } from "../../ui/BrandLink";
import { IconTooltip } from "../../ui/IconTooltip";

export function SidemenuDesktopHeader({ isDesktopCollapsed }: { isDesktopCollapsed: boolean }) {
  return (
    <div
      className={`border-border box-content hidden h-(--navbar-height) shrink-0 items-center border-b transition-[padding] duration-300 lg:flex ${
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
