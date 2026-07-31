"use client";

import Link from "next/link";

import { FLLogo } from "../../ui/FLLogo";
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
        <Link
          href="/"
          title="Zur öffentlichen Website"
          className={`text-foreground flex items-center font-bold tracking-tight transition-opacity hover:opacity-80 ${
            isDesktopCollapsed ? "justify-center" : "gap-2"
          }`}>
          <FLLogo />

          {!isDesktopCollapsed && "Frankfurt-League"}
        </Link>
      </IconTooltip>
    </div>
  );
}
