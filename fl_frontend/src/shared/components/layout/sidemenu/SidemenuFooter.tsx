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
    <div className={`border-border flex items-center border-t p-3 ${isDesktopCollapsed ? "flex-col justify-center gap-3" : "justify-between"}`}>
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

      <div className={`flex items-center ${isDesktopCollapsed ? "flex-col gap-3" : "gap-1"}`}>
        <SidemenuOptionsMenu isDesktopCollapsed={isDesktopCollapsed} />

        {/* Desktop Collapse Toggle — always tooltipped, because its label is the state itself */}
        <IconTooltip
          label={isDesktopCollapsed ? "Menü ausklappen" : "Menü einklappen"}
          placement="right">
          <button
            onClick={onToggleDesktopMenu}
            className="text-foreground-muted hover:bg-muted hover:text-foreground hidden h-9 w-9 shrink-0 items-center justify-center rounded-md transition-colors lg:flex"
            aria-label={isDesktopCollapsed ? "Menü ausklappen" : "Menü einklappen"}>
            {isDesktopCollapsed ? (
              <LayoutSideContentRight className="h-[18px] w-[18px]" />
            ) : (
              <LayoutSideContentLeft className="h-[18px] w-[18px]" />
            )}
          </button>
        </IconTooltip>
      </div>
    </div>
  );
}
