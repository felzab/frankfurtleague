"use client";

import Link from "next/link";

import { ArrowRightToSquare, LayoutSideContentLeft, LayoutSideContentRight } from "@gravity-ui/icons";

import { Tooltip } from "@heroui/react";

export default function SidemenuFooter({
  isDesktopCollapsed,
  onToggleDesktopMenu,
}: {
  isDesktopCollapsed: boolean;
  onToggleDesktopMenu: () => void;
}) {
  return (
    <div className={`border-border flex items-center border-t p-3 ${isDesktopCollapsed ? "flex-col justify-center gap-3" : "justify-between"}`}>
      {/* Escape Hatch */}
      <Tooltip delay={0}>
        <Tooltip.Trigger>
          <Link
            href="/"
            className={`text-foreground-muted hover:bg-muted hover:text-foreground flex h-9 items-center rounded-md transition-colors ${
              isDesktopCollapsed ? "w-9 justify-center" : "w-full justify-start gap-2.5 px-3"
            }`}
            aria-label="Zur öffentlichen Website">
            <ArrowRightToSquare className="h-[18px] w-[18px] shrink-0" />
            {!isDesktopCollapsed && <span className="text-fluid-sm font-medium">Zur Website</span>}
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

      {/* Desktop Collapse Toggle */}
      <Tooltip delay={0}>
        <Tooltip.Trigger>
          <button
            onClick={onToggleDesktopMenu}
            className="text-foreground-muted hover:bg-muted hover:text-foreground hidden h-9 w-9 shrink-0 items-center justify-center rounded-md transition-colors xl:flex"
            aria-label="Toggle Desktop Menu">
            {isDesktopCollapsed ? (
              <LayoutSideContentRight className="h-[18px] w-[18px]" />
            ) : (
              <LayoutSideContentLeft className="h-[18px] w-[18px]" />
            )}
          </button>
        </Tooltip.Trigger>
        <Tooltip.Content
          placement="right"
          className="bg-surface text-foreground border-border text-fluid-xs rounded-md border px-2.5 py-1 shadow-md">
          {isDesktopCollapsed ? "Menü ausklappen" : "Menü einklappen"}
        </Tooltip.Content>
      </Tooltip>
    </div>
  );
}
