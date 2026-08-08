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
  /** Forwarded to the footer's options menu; the bar carries the same control (ADR-0058). */
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
    /* `fixed` and full height: below `lg` the drawer OVERLAYS the bar rather than opening beneath it,
       which is why it carries its own close control (`SidemenuDrawerHeader`) — the bar's toggle is
       behind it while it is open. On `lg` it becomes an ordinary flex item again.

       **`lg:h-auto` is not tidying, it is what stops the whole page scrolling.** `h-dvh` is right for
       the overlay, which starts at the top of the viewport; the desktop rail starts BELOW the 54px
       bar, so the same height overshoots the row by exactly the bar and pushes the document 54px past
       the viewport. Left at `h-dvh` the sidemenu and the content scroll together, which is the one
       thing this shell exists to prevent — the rail must take its height from the row, and the row
       takes its own from what is left under the bar.

       `invisible` is load-bearing while the drawer is closed. `translate-x` alone moves the panel
       off-screen but removes it from neither the tab order nor the accessibility tree, so a phone
       user tabbing the page falls into a dozen controls sitting 310px off the left edge with focus
       invisible. `invisible` takes the subtree out of both, and `lg:visible` restores it for the
       desktop rail, which is this same element above `lg`.

       Visibility rather than `inert`, which would need the breakpoint duplicated in JS as a
       matchMedia string. It also survives before hydration, and it does not cut the slide-out short:
       CSS Transitions interpolate `visibility` discretely, holding the visible end for the whole
       duration, so the panel stays on screen until the slide finishes.

       **The transition names `translate`, not `transform`, and that is what makes the drawer slide
       at all.** Tailwind v4 emits `-translate-x-full` as the standalone `translate` property rather
       than as a `transform` function — measured here as `translate: -100%` with `transform: none` —
       so a transition list naming `transform` interpolates a property that never changes and the
       panel jumps between its two positions instead of moving. The same is true of `scale-*`, which
       is why `OptionsMenu` cancels a press effect with `transform-none` rather than `scale-100`. */
    <aside
      id="app-sidemenu"
      className={`bg-surface border-border text-foreground fixed inset-y-0 left-0 z-50 flex h-dvh flex-col border-r transition-[width,translate,visibility] duration-300 ease-in-out lg:visible lg:h-auto ${
        isMobileOpen ? "visible translate-x-0" : "invisible -translate-x-full"
      } lg:relative lg:z-0 lg:shrink-0 lg:translate-x-0 ${railWidth}`}>
      <SidemenuDrawerHeader onClose={onMobileClose} />

      {/* MAIN SCROLLABLE CONTENT

          The gutter is reserved on BOTH edges while collapsed (owner, 2026-08-07). At 72px with `px-3`
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
