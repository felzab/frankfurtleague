"use client";

import Link from "next/link";

import { ArrowRightToSquare, LayoutSideContentLeft, LayoutSideContentRight } from "@gravity-ui/icons";

import { IconTooltip } from "../../ui/IconTooltip";
import { SidemenuOptionsMenu } from "./SidemenuOptionsMenu";

import type { FormState } from "@/shared/types/types";

export function SidemenuFooter({
  isDesktopCollapsed,
  onToggleDesktopMenu,
  onSignOut,
}: {
  isDesktopCollapsed: boolean;
  onToggleDesktopMenu: () => void;
  onSignOut?: () => Promise<FormState>;
}) {
  return (
    <div className={`border-border flex flex-col border-t p-3 ${isDesktopCollapsed ? "items-center gap-3" : "gap-1"}`}>
      {/* Options first: expanded it is a full-width row whose menu opens above it at the same
          width, which is what keeps the menu inside the sidemenu (standard sidebar-footer pattern).
          The bar carries the same two controls inline (ADR-0058); this is a second placement of the
          same components, not a second implementation. */}
      <SidemenuOptionsMenu
        isDesktopCollapsed={isDesktopCollapsed}
        onSignOut={onSignOut}
      />

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
          {!isDesktopCollapsed && <span className="fluid-sm font-medium">Zur Website</span>}
        </Link>
      </IconTooltip>

      {/* Desktop Collapse Toggle. Tooltipped only while collapsed, like the two controls above it:
          expanded, the button already carries "Menü einklappen" as visible text, so the tooltip was
          repeating a label the user could read — the one case a tooltip is noise rather than help. */}
      <IconTooltip
        label={isDesktopCollapsed ? "Menü ausklappen" : "Menü einklappen"}
        placement="right"
        isEnabled={isDesktopCollapsed}>
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
          {!isDesktopCollapsed && <span className="fluid-sm font-medium">Menü einklappen</span>}
        </button>
      </IconTooltip>
    </div>
  );
}
