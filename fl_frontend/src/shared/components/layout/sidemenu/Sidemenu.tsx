"use client";

// Redesign: goes with its last importer; `kit/RailFrame` replaces it.
import React, { Suspense } from "react";

import { SaisonSlotSkeleton } from "../../ui/SaisonSlotSkeleton";
import { RAIL_WIDTH_LG_CLASSES } from "../shell/railWidth";
import { RAIL_GUTTER_CLASSES } from "./railGutter";
import { SidemenuDrawerHeader } from "./SidemenuDrawerHeader";
import { SidemenuFooter } from "./SidemenuFooter";
import { SidemenuStateProvider } from "./SidemenuState";

import type { SignOutResult } from "@/shared/types/types";
import type { LinkPrefix } from "../shell/linkPrefix";

/** The navigation rail, fully controlled by `AppShell`. */
export function Sidemenu({
  entries,
  linkPrefix,
  keepsSaisonQuery,
  saisonMetadataDisplay,
  funktionSwitcher,
  onSignOut,
  kontoHref,
  isMobileOpen,
  onMobileClose,
  isDesktopCollapsed,
  onToggleDesktopMenu,
}: {
  /** The list of entries (`fl_frontend/src/shared/components/layout/sidemenu/SidemenuNavLinks.tsx :: SidemenuEntries`). */
  entries: React.ReactNode;
  linkPrefix: LinkPrefix;
  keepsSaisonQuery: boolean;
  saisonMetadataDisplay: React.ReactNode;
  funktionSwitcher: React.ReactNode;
  /** Forwarded to the footer's options menu; the bar carries the same control. */
  onSignOut?: () => Promise<SignOutResult>;
  /** Forwarded to that same menu, which is where a phone reaches the account page the bar links from `lg`. */
  kontoHref: string | null;
  isMobileOpen: boolean;
  onMobileClose: () => void;
  isDesktopCollapsed: boolean;
  onToggleDesktopMenu: () => void;
}) {
  // The `lg:` half is shared with the bar's brand block, so the seam between them cannot drift.
  // Hoisted out of the class template for the reason `AppTopBar` gives.
  const railWidth = `w-sidemenu ${RAIL_WIDTH_LG_CLASSES[isDesktopCollapsed ? "collapsed" : "expanded"]}`;
  const railGutter = RAIL_GUTTER_CLASSES[isDesktopCollapsed ? "collapsed" : "expanded"];

  return (
    /* Each fails silently if changed: `lg:h-auto`, or the page scrolls as one; `invisible`, or the closed
       drawer stays in the tab order; `translate` in the transition list, the property v4 actually animates. */
    /* `motion-reduce:transition-none` takes the whole list rather than `translate` alone: the drawer has
       no fade to keep, so what is left once the slide goes is an instant arrival. */
    <aside
      id="app-sidemenu"
      className={`fixed inset-y-0 left-0 z-50 flex h-dvh flex-col border-r border-border bg-surface text-foreground transition-[width,translate,visibility] duration-300 ease-in-out motion-reduce:transition-none lg:visible lg:h-auto ${
        isMobileOpen ? "visible translate-x-0" : "invisible -translate-x-full"
      } lg:relative lg:z-0 lg:shrink-0 lg:translate-x-0 ${railWidth}`}>
      <SidemenuDrawerHeader onClose={onMobileClose} />

      {/* The gutter is reserved on both edges while collapsed: a one-edge reservation takes its strip off the right
          alone, so the icon column sits left of the rail's centre. Expanded, the content is left-aligned text. */}
      <div className={`flex flex-1 flex-col gap-6 overflow-x-hidden overflow-y-auto px-3 py-4 ${railGutter}`}>
        <SidemenuStateProvider
          state={{
            isDesktopCollapsed: isDesktopCollapsed,
            onMobileClose: onMobileClose,
            linkPrefix: linkPrefix,
            keepsSaisonQuery: keepsSaisonQuery,
          }}>
          {/* First, above the season, and kept while collapsed where the season slot is not: which Funktion the
              person is acting in frames everything below it. */}
          {funktionSwitcher}

          {/* The same placeholder `SaisonSelector` shows until it hydrates, so the wait reads as one continuous state. */}
          <Suspense fallback={<SaisonSlotSkeleton />}>
            <div className={`transition-opacity duration-300 ${isDesktopCollapsed ? "hidden h-0 lg:block lg:opacity-0" : "opacity-100"}`}>
              {!isDesktopCollapsed && <>{saisonMetadataDisplay}</>}
            </div>
          </Suspense>

          {entries}
        </SidemenuStateProvider>
      </div>

      <SidemenuFooter
        isDesktopCollapsed={isDesktopCollapsed}
        onToggleDesktopMenu={onToggleDesktopMenu}
        onMobileNavigate={onMobileClose}
        onSignOut={onSignOut}
        kontoHref={kontoHref}
      />
    </aside>
  );
}
