"use client";

import { Suspense, useEffect, useState } from "react";

import { SkipToContentLink } from "../../ui/SkipToContentLink";
import { Sidemenu } from "../sidemenu/Sidemenu";
import { SidemenuEntries } from "../sidemenu/SidemenuNavLinks";
import { AppTopBar } from "./AppTopBar";
import { ShellHeading, ShellTitle } from "./ShellHeading";
import { ShellSaisonQueryProvider } from "./ShellSaisonQuery";

import type { SidemenuHint, SidemenuStructure, SignOutResult } from "@/shared/types/types";
import type React from "react";
import type { LinkPrefix } from "./linkPrefix";

type ShellSection = { label: string; hint: SidemenuHint };

/**
 * Owns both pieces of shell state, each split across two places: the hamburger in the bar, its panel in the sidemenu;
 * the rail's toggle in the footer, its width sizing the brand. **Nothing here reads the address**.
 */
export function AppShell<TIcon extends string>({
  structure,
  entries,
  heading,
  linkPrefix,
  keepsSaisonQuery,
  iconDictionary,
  saisonMetadataDisplay,
  funktionSwitcher,
  unlistedSections = {},
  fallbackTitle,
  fallbackHint,
  kontoHref,
  onSignOut,
  children,
}: {
  /** Every entry the area can list: what the bar's title resolves against, and the rail's list where no `entries` stands. */
  structure: SidemenuStructure<TIcon>;
  /**
   * The rail's list where which entries show is the session's to say, streamed in its own boundary: the area's
   * own entries component, which binds its icons to its structure's type.
   */
  entries?: React.ReactNode;
  /** The bar's heading where the session can change it, standing in for the one `structure` resolves once it renders. */
  heading?: React.ReactNode;
  linkPrefix: LinkPrefix;
  /**
   * Whether the season rides the query as `saison_id`, carried onto every sidemenu entry and the 404's
   * way out. Required: a default would put a stray `?saison_id=` on every link of a shell whose season
   * is in its path or absent.
   */
  keepsSaisonQuery: boolean;
  iconDictionary: Record<TIcon, React.ElementType>;
  saisonMetadataDisplay: React.ReactNode;
  /**
   * The switch between the person's Funktionen, heading the sidemenu. Required, as `saisonMetadataDisplay`
   * is: a signed-in shell leaving it out would strand a person holding several in one area.
   */
  funktionSwitcher: React.ReactNode;
  unlistedSections?: Readonly<Record<string, ShellSection>>;
  /** What the bar reads on an address no entry and no unlisted section claims — the area's name, never a section's. */
  fallbackTitle: string;
  /**
   * Required for the same reason `SidemenuStructureSubOption.hint` is: a glyph present on most routes and absent on one
   * reads as "this page has nothing to explain", which is a claim about the page rather than about the navigation.
   */
  fallbackHint: SidemenuHint;
  /**
   * The person's account page, which the bar links and heads „Konto“; `null` in a shell no session
   * stands behind. Required for `keepsSaisonQuery`'s reason: a default is the forgotten declaration.
   */
  kontoHref: string | null;
  /** Passed to the bar's options menu; a shell for the public dashboard supplies none. */
  onSignOut?: () => Promise<SignOutResult>;
  children: React.ReactNode;
}) {
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [isDesktopCollapsed, setIsDesktopCollapsed] = useState(false);

  // Bound to the document rather than the panel: opening the drawer does not move focus into it, so a
  // handler on the panel would never see the key.
  useEffect(() => {
    if (!isMobileOpen) return;

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsMobileOpen(false);
    };

    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [isMobileOpen]);

  // `lg`, the width at which the rail becomes permanent and the dismiss layer goes. An open state
  // carried across that line would leave `<main>` inert with nothing left on screen to close it.
  useEffect(() => {
    const rail = window.matchMedia("(min-width: 64rem)");
    const closeOnRail = () => {
      if (rail.matches) setIsMobileOpen(false);
    };

    rail.addEventListener("change", closeOnRail);
    return () => rail.removeEventListener("change", closeOnRail);
  }, []);

  const resolvedHeading = (
    <ShellHeading
      structure={structure}
      linkPrefix={linkPrefix}
      unlistedSections={unlistedSections}
      fallback={{ label: fallbackTitle, hint: fallbackHint }}
      kontoHref={kontoHref}
    />
  );

  return (
    /* `data-app-shell` is read by one rule in `globals.css`, which releases the viewport's reserved scrollbar
       gutter on these routes. On the root because a nested layout cannot style the document element. */
    <ShellSaisonQueryProvider keepsSaisonQuery={keepsSaisonQuery}>
      <div
        data-app-shell
        className="flex h-dvh w-full flex-col">
        <SkipToContentLink isTargetInert={isMobileOpen} />

        <AppTopBar
          heading={
            // The area's name and no hint wherever the address is unknown until the request: the build's shell of
            // a route a segment parameter names. The fallback's own hint says the address belongs to no page.
            <Suspense fallback={<ShellTitle label={fallbackTitle} />}>
              {heading === undefined ? resolvedHeading : <Suspense fallback={resolvedHeading}>{heading}</Suspense>}
            </Suspense>
          }
          isMobileOpen={isMobileOpen}
          onToggleMobileMenu={() => setIsMobileOpen(!isMobileOpen)}
          isDesktopCollapsed={isDesktopCollapsed}
          kontoHref={kontoHref}
          onSignOut={onSignOut}
        />

        {/* A dismiss shortcut for pointers rather than a control, the keyboard paths being the drawer's own close
          button and Escape. `fixed` so it covers the bar too, which the drawer overlays. */}
        <div
          onClick={() => setIsMobileOpen(false)}
          aria-hidden="true"
          className={`fixed inset-0 z-40 bg-black/60 backdrop-blur-sm transition-opacity duration-300 lg:hidden ${
            isMobileOpen ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"
          }`}
        />

        <div className="flex min-h-0 w-full flex-1 flex-row">
          <Sidemenu
            entries={
              entries ?? (
                <SidemenuEntries
                  structure={structure}
                  iconDictionary={iconDictionary}
                />
              )
            }
            linkPrefix={linkPrefix}
            keepsSaisonQuery={keepsSaisonQuery}
            saisonMetadataDisplay={saisonMetadataDisplay}
            funktionSwitcher={funktionSwitcher}
            onSignOut={onSignOut}
            kontoHref={kontoHref}
            isMobileOpen={isMobileOpen}
            onMobileClose={() => setIsMobileOpen(false)}
            isDesktopCollapsed={isDesktopCollapsed}
            onToggleDesktopMenu={() => setIsDesktopCollapsed(!isDesktopCollapsed)}
          />

          {/* `inert` while the drawer is open: the dismiss layer above is opaque and blurred, so every
            tab stop under it is a control the reader is being sent to and cannot see (WCAG 2.4.11). */}
          <main
            id="main-content"
            inert={isMobileOpen}
            className="relative flex min-w-0 flex-1 scrollbar-gutter-stable flex-col overflow-y-auto bg-background">
            {children}
          </main>
        </div>
      </div>
    </ShellSaisonQueryProvider>
  );
}
