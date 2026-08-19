"use client";

import React, { Suspense } from "react";

import { SaisonSlotSkeleton } from "../../ui/SaisonSlotSkeleton";
import { RAIL_WIDTH_LG } from "../shell/railWidth";
import { SidemenuDrawerHeader } from "./SidemenuDrawerHeader";
import { SidemenuFooter } from "./SidemenuFooter";
import { SidemenuNavLinks, SidemenuNavLinksWithSaisonQuery } from "./SidemenuNavLinks";

import type { FormState, SidemenuStructure } from "@/shared/types/types";

/**
 * The navigation rail, fully controlled by `AppShell`. Generic over the icon key, so the structure and the dictionary
 * are checked against each other and `iconDictionary[iconName]` cannot miss.
 */
export function Sidemenu<TIcon extends string>({
  structure,
  linkPrefix,
  saisonMetadataDisplay,
  iconDictionary,
  onSignOut,
  pathname,
  isMobileOpen,
  onMobileClose,
  isDesktopCollapsed,
  onToggleDesktopMenu,
}: {
  structure: SidemenuStructure<TIcon>;
  linkPrefix: string;
  saisonMetadataDisplay: React.ReactNode;
  iconDictionary: Record<TIcon, React.ElementType>;
  /** Forwarded to the footer's options menu; the bar carries the same control. */
  onSignOut?: () => Promise<FormState>;
  pathname: string;
  isMobileOpen: boolean;
  onMobileClose: () => void;
  isDesktopCollapsed: boolean;
  onToggleDesktopMenu: () => void;
}) {
  // The `lg:` half is shared with the bar's brand block, so the seam between them cannot drift.
  // Hoisted out of the class template for the reason `AppTopBar` gives.
  const railWidth = `w-sidemenu ${RAIL_WIDTH_LG[isDesktopCollapsed ? "collapsed" : "expanded"]}`;

  const navLinkProps = {
    structure,
    linkPrefix,
    iconDictionary,
    isDesktopCollapsed,
    pathname,
    onMobileClose,
  };

  return (
    /* Each fails silently if changed: `lg:h-auto`, or the page scrolls as one; `invisible`, or the closed
       drawer stays in the tab order; `translate` in the transition list, the property v4 actually animates. */
    <aside
      id="app-sidemenu"
      className={`bg-surface border-border text-foreground fixed inset-y-0 left-0 z-50 flex h-dvh flex-col border-r transition-[width,translate,visibility] duration-300 ease-in-out lg:visible lg:h-auto ${
        isMobileOpen ? "visible translate-x-0" : "invisible -translate-x-full"
      } lg:relative lg:z-0 lg:shrink-0 lg:translate-x-0 ${railWidth}`}>
      <SidemenuDrawerHeader onClose={onMobileClose} />

      {/* The gutter is reserved on both edges while collapsed: a one-edge reservation takes its strip off the right
          alone, so the icon column sits left of the rail's centre. Expanded, the content is left-aligned text. */}
      <div
        className={`flex flex-1 flex-col gap-6 overflow-x-hidden overflow-y-auto px-3 py-4 ${
          isDesktopCollapsed ? "scrollbar-gutter-stable-both" : "scrollbar-gutter-stable"
        }`}>
        {/* The same placeholder `SaisonSelector` shows until it hydrates, so the wait reads as one continuous state. */}
        <Suspense fallback={<SaisonSlotSkeleton />}>
          <div className={`transition-opacity duration-300 ${isDesktopCollapsed ? "hidden h-0 lg:block lg:opacity-0" : "opacity-100"}`}>
            {!isDesktopCollapsed && <>{saisonMetadataDisplay}</>}
          </div>
        </Suspense>

        {/* `useSearchParams()` lives below this boundary and hangs unconditionally during a prerender, so hoisting
            it bails out the whole route root. Nothing in the fallback may call a dynamic hook either. */}
        <Suspense
          fallback={
            <SidemenuNavLinks
              {...navLinkProps}
              queryString=""
            />
          }>
          <SidemenuNavLinksWithSaisonQuery {...navLinkProps} />
        </Suspense>
      </div>

      <SidemenuFooter
        isDesktopCollapsed={isDesktopCollapsed}
        onToggleDesktopMenu={onToggleDesktopMenu}
        onMobileNavigate={onMobileClose}
        onSignOut={onSignOut}
      />
    </aside>
  );
}
