"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

import { SkipToContentLink } from "../../ui/SkipToContentLink";
import { Sidemenu } from "../sidemenu/Sidemenu";
import { AppTopBar } from "./AppTopBar";

import type { FormState, SidemenuStructure, SidemenuStructureSubOption } from "@/shared/types/types";
import type React from "react";

/**
 * The chrome both signed-in shells share: one bar across the viewport, the sidemenu and the content
 * beneath it.
 *
 * **It exists because the bar and the drawer are one control split across two places.** The
 * hamburger lives in the bar and the panel it opens lives in the sidemenu, so the open state has to
 * be owned above both — and the same is true of the collapsed rail, whose toggle is in the
 * sidemenu's footer while its width decides the bar's brand treatment. Holding that state in the
 * sidemenu, as it used to be, is only possible while the sidemenu also owns the bar, which is the
 * arrangement this replaces.
 *
 * `children` is the route's own content and stays server-rendered: passing it through a client
 * component does not make it one.
 *
 * ```
 * ┌─────────────────────────────────────────┐
 * │ AppTopBar        (h-(--navbar-height))  │  ← spans the viewport
 * ├───────────┬─────────────────────────────┤
 * │ Sidemenu  │ main#main-content           │  ← the row that scrolls
 * └───────────┴─────────────────────────────┘
 * ```
 */
export function AppShell<TIcon extends string>({
  structure,
  linkPrefix,
  iconDictionary,
  saisonMetadataDisplay,
  fallbackTitle,
  onSignOut,
  children,
}: {
  structure: SidemenuStructure<TIcon>;
  linkPrefix: string;
  iconDictionary: Record<TIcon, React.ElementType>;
  saisonMetadataDisplay: React.ReactNode;
  /**
   * What the bar reads on a route the navigation does not name — the match editor and the two team
   * detail pages, which sit under a nav section rather than being one. Those pages carry their own
   * `h2` naming their subject, so the bar names the section and the page names the record.
   */
  fallbackTitle: string;
  /** Passed to the bar's options menu; only the admin shell supplies one. */
  onSignOut?: () => Promise<FormState>;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [isDesktopCollapsed, setIsDesktopCollapsed] = useState(false);

  // Escape closes the drawer. Bound to the document rather than to the panel: opening the drawer
  // does not move focus into it, so focus is still on the bar's hamburger — outside that subtree —
  // and a handler on the panel would never see the key.
  useEffect(() => {
    if (!isMobileOpen) return;

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsMobileOpen(false);
    };

    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [isMobileOpen]);

  // The nav entry whose section this route is in, matched on the FIRST segment after the prefix — so
  // `/dashboard/teams/<id>` resolves to the Teams entry rather than to nothing, and its detail page
  // still gets a title and a hint.
  const baseSegment = pathname.replace(`${linkPrefix}/`, "").split("/")[0];
  const activeOption: SidemenuStructureSubOption<TIcon> | undefined = structure
    .flatMap((group) => group.sub_options)
    .find((option) => option.id === baseSegment);

  return (
    /* `data-app-shell` is read by one rule in `globals.css`, which releases the viewport's reserved
       scrollbar gutter on these routes. See the note there — the marker is on the root rather than on
       <html> because a nested layout cannot style the document element. */
    <div
      data-app-shell
      className="flex h-dvh w-full flex-col">
      <SkipToContentLink />

      <AppTopBar
        title={activeOption?.label ?? fallbackTitle}
        hint={activeOption?.hint}
        isMobileOpen={isMobileOpen}
        onToggleMobileMenu={() => setIsMobileOpen(!isMobileOpen)}
        isDesktopCollapsed={isDesktopCollapsed}
        onSignOut={onSignOut}
      />

      {/* **`min-h-0` is load-bearing and invisible when it is missing.** A flex item's default
          `min-height` is `auto`, which is its content's height — so without this the row grows to fit
          the page, `main`'s `overflow-y-auto` never has a smaller box to scroll inside, and the whole
          document scrolls instead. The bar then leaves the top of the screen, which is the one thing
          a shell bar must not do.

          The drawer is viewport-`fixed` rather than positioned against this row: below `lg` it
          overlays the bar (my call), which a row-relative panel could not do. */}
      {/* A dismiss shortcut for pointers, not a control: `aria-hidden` and not focusable on purpose,
          because the keyboard paths are the drawer's own close button and Escape. `fixed`, so it
          covers the bar too — the drawer overlays it, and a backdrop stopping short would leave a
          live strip above an overlay. */}
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
