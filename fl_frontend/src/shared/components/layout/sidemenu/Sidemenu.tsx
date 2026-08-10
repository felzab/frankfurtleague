"use client";

import React, { Suspense } from "react";

import { SaisonSlotSkeleton } from "../../ui/SaisonSlotSkeleton";
import { RAIL_WIDTH_LG } from "../shell/railWidth";
import { SidemenuDrawerHeader } from "./SidemenuDrawerHeader";
import { SidemenuFooter } from "./SidemenuFooter";
import { SidemenuNavLinks, SidemenuNavLinksWithSaisonQuery } from "./SidemenuNavLinks";

import type { FormState, SidemenuStructure } from "@/shared/types/types";

/**
 * The navigation rail, and nothing else.
 *
 * **It is fully controlled**: `AppShell` owns both pieces of shell state, because the control that
 * opens the drawer is in the bar above and the title the bar shows comes from the same structure
 * this renders. A rail that also held that state could only work while it also held the bar.
 *
 * On `lg` it carries no header: the brand mark and the page title are the bar's (`AppTopBar`). Below
 * that, `SidemenuDrawerHeader` gives the panel its own brand row and close button, because the
 * drawer overlays the bar and carries its own close control. Its footer keeps the options menu, the
 * way back to the public site and the collapse toggle.
 *
 * Generic over the icon key: the structure and the dictionary are checked against each other, so
 * `iconDictionary[iconName]` is a total lookup and cannot miss.
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
  /** Forwarded to the footer's options menu; the bar carries the same control (ADR-0046). */
  onSignOut?: () => Promise<FormState>;
  pathname: string;
  isMobileOpen: boolean;
  onMobileClose: () => void;
  isDesktopCollapsed: boolean;
  onToggleDesktopMenu: () => void;
}) {
  // `w-sidemenu` is the base because below `lg` this is the drawer; the `lg:` half is shared with the
  // bar's brand block so the seam between them cannot drift. Hoisted out of the class template for the
  // reason given in `AppTopBar`.
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
    /* Each of these fails silently if changed: `lg:h-auto`, or the page scrolls as
       one; `invisible`, or the closed drawer stays in the tab order; `translate` in
       the transition list, which is the property Tailwind v4 actually animates. */
    <aside
      id="app-sidemenu"
      className={`bg-surface border-border text-foreground fixed inset-y-0 left-0 z-50 flex h-dvh flex-col border-r transition-[width,translate,visibility] duration-300 ease-in-out lg:visible lg:h-auto ${
        isMobileOpen ? "visible translate-x-0" : "invisible -translate-x-full"
      } lg:relative lg:z-0 lg:shrink-0 lg:translate-x-0 ${railWidth}`}>
      <SidemenuDrawerHeader onClose={onMobileClose} />

      {/* MAIN SCROLLABLE CONTENT

          The gutter is reserved on BOTH edges while collapsed (decided 2026-08-07). At 72px with `px-3`
          this container has 48px of content, and a one-edge reservation takes ~15px off the right alone —
          so every icon sat correctly centred in its own box and the whole column sat left of the rail's
          centre. `both-edges` spends the same strip twice and puts the centre back where the eye expects
          it. Expanded, the content is left-aligned text and the one-edge value is the right trade. */}
      <div
        className={`flex flex-1 flex-col gap-6 overflow-x-hidden overflow-y-auto px-3 py-4 ${
          isDesktopCollapsed ? "scrollbar-gutter-stable-both" : "scrollbar-gutter-stable"
        }`}>
        {/* The same placeholder `SaisonSelector` shows until it hydrates, so the wait reads as one
            continuous state rather than skeleton → dead control → live control. */}
        <Suspense fallback={<SaisonSlotSkeleton />}>
          <div className={`transition-opacity duration-300 ${isDesktopCollapsed ? "hidden h-0 lg:block lg:opacity-0" : "opacity-100"}`}>
            {!isDesktopCollapsed && <>{saisonMetadataDisplay}</>}
          </div>
        </Suspense>

        {/* Navigation Links.
            The boundary is what gives the dashboard and admin shells their static content:
            `useSearchParams()` lives below it, in the -WithSaisonQuery variant, and it hangs
            unconditionally during a prerender. Hoisting that hook above the boundary — to the top
            of this component, say — bails out the whole route root.
            The fallback is the same list with an empty query string, so the shell holds real,
            working nav links and the request-time pass only adds `?saison_id=` to their hrefs.
            Nothing about it may call a dynamic hook, or the fallback suspends too and the bailout
            simply moves back up. */}
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
        onSignOut={onSignOut}
      />
    </aside>
  );
}
