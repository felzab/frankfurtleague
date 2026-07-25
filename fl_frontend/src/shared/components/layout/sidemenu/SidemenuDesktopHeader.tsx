"use client";

import Link from "next/link";

import { Tooltip } from "@heroui/react";

import { FLLogo } from "../../ui/FLLogo";

export default function SidemenuDesktopHeader({ isDesktopCollapsed }: { isDesktopCollapsed: boolean }) {
  return (
    <div
      className={`border-border hidden h-14 shrink-0 items-center border-b transition-all xl:flex ${
        isDesktopCollapsed ? "justify-center" : "justify-start px-4"
      }`}>
      <Tooltip delay={0}>
        <Tooltip.Trigger>
          <Link
            href="/"
            title="Zur öffentlichen Website"
            className={`text-foreground flex items-center font-bold tracking-tight transition-opacity hover:opacity-80 ${
              isDesktopCollapsed ? "justify-center" : "gap-2"
            }`}>
            <FLLogo />

            {!isDesktopCollapsed && "Frankfurt-League"}
          </Link>
        </Tooltip.Trigger>

        {isDesktopCollapsed && (
          <Tooltip.Content
            placement="right"
            className="bg-surface text-foreground border-border text-fluid-xs rounded-md border px-2.5 py-1 shadow-md">
            Zur öffentlichen Website
          </Tooltip.Content>
        )}
      </Tooltip>
    </div>
  );
}
