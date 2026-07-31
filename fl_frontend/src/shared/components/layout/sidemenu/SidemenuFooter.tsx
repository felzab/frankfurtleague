"use client";

import Link from "next/link";

import { ArrowRightToSquare, LayoutSideContentLeft, LayoutSideContentRight } from "@gravity-ui/icons";

import { IconTooltip } from "../../ui/IconTooltip";
import { SidemenuOptionsMenu } from "./SidemenuOptionsMenu";

export default function SidemenuFooter({
  isDesktopCollapsed,
  onToggleDesktopMenu,
}: {
  isDesktopCollapsed: boolean;
  onToggleDesktopMenu: () => void;
}) {
  return (
    <div className={`border-border flex flex-col border-t p-3 ${isDesktopCollapsed ? "items-center gap-3" : "gap-1"}`}>
      {/* Options first: expanded it is a full-width row whose menu opens above it at the same
          width, which is what keeps the menu inside the sidemenu (standard sidebar-footer pattern). */}
      <SidemenuOptionsMenu isDesktopCollapsed={isDesktopCollapsed} />

      {/* Escape Hatch */}
      <IconTooltip
        label="Zur öffentlichen Website"
        placement="right"
        isEnabled={isDesktopCollapsed}>
        <Link
          href="/"
          className={`text-foreground-muted hover:bg-muted hover:text-foreground flex h-9 items-center rounded-md transition-colors ${
            isDesktopCollapsed ? "w-9 justify-center" : "w-full justify-start gap-2.5 px-3"
          }`}
          aria-label="Zur öffentlichen Website">
          <ArrowRightToSquare className="h-[18px] w-[18px] shrink-0" />
          {!isDesktopCollapsed && <span className="text-fluid-sm font-medium">Zur Website</span>}
        </Link>
      </IconTooltip>

      {/* Desktop Collapse Toggle — always tooltipped, because its label is the state itself */}
      <IconTooltip
        label={isDesktopCollapsed ? "Menü ausklappen" : "Menü einklappen"}
        placement="right">
        <button
          onClick={onToggleDesktopMenu}
          className={`text-foreground-muted hover:bg-muted hover:text-foreground hidden h-9 shrink-0 items-center rounded-md transition-colors lg:flex ${
            isDesktopCollapsed ? "w-9 justify-center" : "w-full justify-start gap-2.5 px-3"
          }`}
          aria-label={isDesktopCollapsed ? "Menü ausklappen" : "Menü einklappen"}>
          {isDesktopCollapsed ? (
            <LayoutSideContentRight className="h-[18px] w-[18px] shrink-0" />
          ) : (
            <LayoutSideContentLeft className="h-[18px] w-[18px] shrink-0" />
          )}
          {!isDesktopCollapsed && <span className="text-fluid-sm font-medium">Menü einklappen</span>}
        </button>
      </IconTooltip>
    </div>
  );
}
