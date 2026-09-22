"use client";

import Link from "next/link";

import { ArrowRightToSquare, LayoutSideContentLeft, LayoutSideContentRight } from "@gravity-ui/icons";

import { IconTooltip } from "../../ui/IconTooltip";
import { RAIL_GUTTER, RAIL_SQUARE_RING } from "./railGutter";
import { SidemenuOptionsMenu } from "./SidemenuOptionsMenu";

import type { FormState } from "@/shared/types/types";

export function SidemenuFooter({
  isDesktopCollapsed,
  onToggleDesktopMenu,
  onMobileNavigate,
  onSignOut,
  onManagePasskeys,
}: {
  isDesktopCollapsed: boolean;
  onToggleDesktopMenu: () => void;
  /** Required, not optional: `Sidemenu` is the only caller and it always owns the drawer's state. */
  onMobileNavigate: () => void;
  onSignOut?: () => Promise<FormState>;
  onManagePasskeys?: () => void;
}) {
  // Hoisted out of the class template for the reason `AppTopBar` gives.
  const railGutter = RAIL_GUTTER[isDesktopCollapsed ? "collapsed" : "expanded"];

  return (
    // `overflow-hidden` is what lets the gutter apply: `scrollbar-gutter` reserves nothing on a box that does not clip.
    <div
      className={`border-border flex flex-col overflow-hidden border-t p-3 ${railGutter} ${isDesktopCollapsed ? "items-center gap-3" : "gap-1"}`}>
      {/* Options first: expanded, its menu opens above a full-width row at that row's width, which is what keeps
          the menu inside the sidemenu. */}
      <SidemenuOptionsMenu
        isDesktopCollapsed={isDesktopCollapsed}
        onSignOut={onSignOut}
        onManagePasskeys={onManagePasskeys}
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
            isDesktopCollapsed ? `w-9 justify-center ${RAIL_SQUARE_RING}` : "w-full justify-start gap-2 px-3"
          }`}
          aria-label="Zur öffentlichen Website">
          <ArrowRightToSquare
            aria-hidden="true"
            className="size-4.5 shrink-0"
          />
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
            isDesktopCollapsed ? `w-9 justify-center ${RAIL_SQUARE_RING}` : "w-full justify-start gap-2 px-3"
          }`}
          aria-label={isDesktopCollapsed ? "Menü ausklappen" : "Menü einklappen"}>
          {isDesktopCollapsed ? (
            <LayoutSideContentRight
              aria-hidden="true"
              className="size-4.5 shrink-0"
            />
          ) : (
            <LayoutSideContentLeft
              aria-hidden="true"
              className="size-4.5 shrink-0"
            />
          )}
          {!isDesktopCollapsed && <span className="fluid-sm font-medium">Menü einklappen</span>}
        </button>
      </IconTooltip>
    </div>
  );
}
