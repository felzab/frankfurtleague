"use client";

import Link from "next/link";

import { ArrowRightToSquare, LayoutSideContentLeft, LayoutSideContentRight } from "@gravity-ui/icons";

import { IconTooltip } from "../../ui/IconTooltip";
import { SidemenuOptionsMenu } from "./SidemenuOptionsMenu";

import type { FormState } from "@/shared/types/types";

export function SidemenuFooter({
  isDesktopCollapsed,
  onToggleDesktopMenu,
  onMobileNavigate,
  onSignOut,
}: {
  isDesktopCollapsed: boolean;
  onToggleDesktopMenu: () => void;
  /** Required, not optional: `Sidemenu` is the only caller and it always owns the drawer's state. */
  onMobileNavigate: () => void;
  onSignOut?: () => Promise<FormState>;
}) {
  return (
    <div className={`border-border flex flex-col border-t p-3 ${isDesktopCollapsed ? "items-center gap-3" : "gap-1"}`}>
      {/* Options first: expanded, its menu opens above a full-width row at that row's width, which is what keeps
          the menu inside the sidemenu. */}
      <SidemenuOptionsMenu
        isDesktopCollapsed={isDesktopCollapsed}
        onSignOut={onSignOut}
      />

      <IconTooltip
        label="Zur öffentlichen Website"
        placement="right"
        isEnabled={isDesktopCollapsed}>
        {/* This link leaves the shell, so it closes the drawer itself: the router hides the departing tree rather
            than unmounting it, and Back would otherwise reveal the drawer still up. */}
        <Link
          href="/"
          onNavigate={onMobileNavigate}
          className={`text-foreground-muted hover:bg-hover hover:text-foreground flex h-9 items-center rounded-md transition-colors ${
            isDesktopCollapsed ? "w-9 justify-center" : "w-full justify-start gap-2.5 px-3"
          }`}
          aria-label="Zur öffentlichen Website">
          <ArrowRightToSquare className="h-[18px] w-[18px] shrink-0" />
          {!isDesktopCollapsed && <span className="fluid-sm font-medium">Zur Website</span>}
        </Link>
      </IconTooltip>

      {/* Tooltipped only while collapsed, as the controls above it are: expanded, the button already carries
          its label as visible text. */}
      <IconTooltip
        label={isDesktopCollapsed ? "Menü ausklappen" : "Menü einklappen"}
        placement="right"
        isEnabled={isDesktopCollapsed}>
        <button
          onClick={onToggleDesktopMenu}
          className={`text-foreground-muted hover:bg-hover hover:text-foreground hidden h-9 shrink-0 items-center rounded-md transition-colors lg:flex ${
            isDesktopCollapsed ? "w-9 justify-center" : "w-full justify-start gap-2.5 px-3"
          }`}
          aria-label={isDesktopCollapsed ? "Menü ausklappen" : "Menü einklappen"}>
          {isDesktopCollapsed ? (
            <LayoutSideContentRight className="h-[18px] w-[18px] shrink-0" />
          ) : (
            <LayoutSideContentLeft className="h-[18px] w-[18px] shrink-0" />
          )}
          {!isDesktopCollapsed && <span className="fluid-sm font-medium">Menü einklappen</span>}
        </button>
      </IconTooltip>
    </div>
  );
}
