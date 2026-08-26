"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

import { SkipToContentLink } from "../../ui/SkipToContentLink";
import { Sidemenu } from "../sidemenu/Sidemenu";
import { AppTopBar } from "./AppTopBar";

import type { FormState, SidemenuHint, SidemenuStructure, SidemenuStructureSubOption } from "@/shared/types/types";
import type React from "react";

/**
 * Owns both pieces of shell state, each being one control split across two places: the hamburger is in the bar and its
 * panel in the sidemenu, and the rail's toggle is in the footer while its width decides the bar's brand treatment.
 */
export function AppShell<TIcon extends string>({
  structure,
  linkPrefix,
  iconDictionary,
  saisonMetadataDisplay,
  fallbackTitle,
  fallbackHint,
  onSignOut,
  children,
}: {
  structure: SidemenuStructure<TIcon>;
  linkPrefix: string;
  iconDictionary: Record<TIcon, React.ElementType>;
  saisonMetadataDisplay: React.ReactNode;
  /**
   * What the bar reads on a route the navigation does not name. Such a page carries its own `h2` naming its subject, so
   * the bar names the section and the page names the record.
   */
  fallbackTitle: string;
  /**
   * Required for the same reason `SidemenuStructureSubOption.hint` is: a glyph present on most routes and absent on one
   * reads as "this page has nothing to explain", which is a claim about the page rather than about the navigation.
   */
  fallbackHint: SidemenuHint;
  /** Passed to the bar's options menu; only the admin shell supplies one. */
  onSignOut?: () => Promise<FormState>;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
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

  // Matched on the first segment after the prefix, so a detail route resolves to its section's entry
  // and still gets a title and a hint.
  const baseSegment = pathname.replace(`${linkPrefix}/`, "").split("/")[0];
  const activeOption: SidemenuStructureSubOption<TIcon> | undefined = structure
    .flatMap((group) => group.sub_options)
    .find((option) => option.id === baseSegment);

  return (
    /* `data-app-shell` is read by one rule in `globals.css`, which releases the viewport's reserved scrollbar
       gutter on these routes. On the root because a nested layout cannot style the document element. */
    <div
      data-app-shell
      className="flex h-dvh w-full flex-col">
      <SkipToContentLink />

      <AppTopBar
        title={activeOption?.label ?? fallbackTitle}
        hint={activeOption?.hint ?? fallbackHint}
        isMobileOpen={isMobileOpen}
        onToggleMobileMenu={() => setIsMobileOpen(!isMobileOpen)}
        isDesktopCollapsed={isDesktopCollapsed}
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
          structure={structure}
          linkPrefix={linkPrefix}
          iconDictionary={iconDictionary}
          saisonMetadataDisplay={saisonMetadataDisplay}
          onSignOut={onSignOut}
          pathname={pathname}
          isMobileOpen={isMobileOpen}
          onMobileClose={() => setIsMobileOpen(false)}
          isDesktopCollapsed={isDesktopCollapsed}
          onToggleDesktopMenu={() => setIsDesktopCollapsed(!isDesktopCollapsed)}
        />

        <main
          id="main-content"
          className="bg-background relative flex min-w-0 flex-1 scrollbar-gutter-stable flex-col overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
