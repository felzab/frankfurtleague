"use client";

import React, { Suspense, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

import { Separator } from "@heroui/react";

import SidemenuDesktopHeader from "./SidemenuDesktopHeader";
import { SidemenuDrawerHeader } from "./SidemenuDrawerHeader";
import SidemenuFooter from "./SidemenuFooter";
import SidemenuMobileHeader from "./SidemenuMobileHeader";
import SidemenuNavItem from "./SidemenuNavItem";

import type { SidemenuStructure } from "@/shared/types/types";

// Generic over the icon key: the structure and the dictionary are checked against each other, so
// iconDictionary[iconName] is a total lookup and cannot miss.
export default function Sidemenu<TIcon extends string>({
  structure,
  linkPrefix,
  saisonMetadataDisplay,
  iconDictionary,
  onSignOut,
}: {
  structure: SidemenuStructure<TIcon>;
  linkPrefix: string;
  saisonMetadataDisplay: React.ReactNode;
  iconDictionary: Record<TIcon, React.ElementType>;
  /** Passed to the footer's options menu; only the admin shell supplies one. */
  onSignOut?: () => Promise<void>;
}) {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [isDesktopCollapsed, setIsDesktopCollapsed] = useState(false);

  // Escape closes the open drawer. Bound to the document, not the <aside>: opening the drawer does
  // not move focus into it, so focus is still on the hamburger in `SidemenuMobileHeader` — outside
  // this subtree — and a handler on the panel would never see the key. Tabbing forward from the
  // hamburger does reach the drawer, since it comes later in DOM order.
  React.useEffect(() => {
    if (!isMobileOpen) return;

    const closeOnEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsMobileOpen(false);
    };

    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [isMobileOpen]);

  const globalSaisonId = searchParams.get("saison_id");
  const globalQuery = new URLSearchParams();
  if (globalSaisonId) {
    globalQuery.set("saison_id", globalSaisonId);
  }
  const queryString = globalQuery.toString();

  const _toggleMobileMenu = () => setIsMobileOpen(!isMobileOpen);
  const _toggleDesktopMenu = () => setIsDesktopCollapsed(!isDesktopCollapsed);
  const _checkIsActive = (itemId: string) => {
    const targetPath = `${linkPrefix}/${itemId}`;
    return pathname === targetPath || pathname.startsWith(`${targetPath}/`);
  };

  const baseSegment = pathname.replace(`${linkPrefix}/`, "").split("/")[0];
  const activeOption = structure.flatMap((g) => g.sub_options).find((o) => o.id === baseSegment);
  const displayTitle = activeOption ? activeOption.label : "Dashboard";

  return (
    <>
      <SidemenuMobileHeader
        displayTitle={displayTitle}
        onToggleMenu={_toggleMobileMenu}
      />

      {/* MOBILE BACKDROP — a dismiss shortcut for pointers, not a control. It is `aria-hidden` and
          not focusable on purpose; the keyboard paths are the close button and Escape above. */}
      <div
        onClick={_toggleMobileMenu}
        aria-hidden="true"
        className={`fixed inset-0 z-40 bg-black/60 backdrop-blur-sm transition-opacity duration-300 lg:hidden ${
          isMobileOpen ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"
        }`}
      />

      {/* CLOUDFLARE STYLE SIDEBAR
          Closed, the drawer used to be only translated off-screen, and `translate-x` removes an
          element from neither the tab order nor the accessibility tree — so a phone user tabbing the
          page fell into 11-14 controls sitting 310px off the left edge, with focus invisible
          (R4 §1.2). `invisible` fixes that in CSS: it takes the subtree out of both, and `lg:visible`
          restores it for the desktop rail, which is this same element above `lg`.

          Visibility rather than `inert`, which would need the breakpoint duplicated in JS as a
          matchMedia string. It also survives before hydration, and it does not cut the slide-out
          short: CSS Transitions interpolate `visibility` discretely, holding the visible end for the
          whole duration, so the panel stays on screen until the transform finishes.

          Escape is handled in the effect above — see the note there for why the listener has to be
          on the document. */}
      <aside
        className={`bg-surface border-border text-foreground fixed inset-y-0 left-0 z-50 flex h-dvh flex-col border-r transition-[width,transform,visibility] duration-300 ease-in-out lg:visible ${
          isMobileOpen ? "visible translate-x-0" : "invisible -translate-x-full"
        } lg:relative lg:z-0 lg:shrink-0 lg:translate-x-0 ${isDesktopCollapsed ? "lg:w-sidemenu-collapsed" : "w-sidemenu"}`}>
        <SidemenuDesktopHeader isDesktopCollapsed={isDesktopCollapsed} />

        <SidemenuDrawerHeader onClose={() => setIsMobileOpen(false)} />

        {/* MAIN SCROLLABLE CONTENT */}
        <div className="flex flex-1 scrollbar-gutter-stable flex-col gap-6 overflow-x-hidden overflow-y-auto px-3 py-4">
          {/* The skeleton carries no text, so without a labelled status region a screen-reader user
              gets silence while the season selector loads (R4 §4.6). */}
          <Suspense
            fallback={
              <div
                role="status"
                aria-label="Saisonauswahl wird geladen"
                className="bg-muted h-[70px] w-full animate-pulse rounded-xl"
              />
            }>
            <div className={`transition-all duration-300 ${isDesktopCollapsed ? "hidden h-0 lg:block lg:opacity-0" : "opacity-100"}`}>
              {!isDesktopCollapsed && <>{saisonMetadataDisplay}</>}
            </div>
          </Suspense>

          {/* Navigation Links */}
          <div className="flex flex-col gap-5">
            {structure.map((group) => (
              <div
                key={group.category_name}
                className="flex flex-col gap-1">
                {!isDesktopCollapsed ? (
                  <span className="text-foreground-muted text-fluid-sm px-2 pb-1 font-medium">{group.category_name}</span>
                ) : (
                  <Separator className="bg-border my-1 w-1/2 self-center" />
                )}

                <div className="flex flex-col gap-[2px]">
                  {group.sub_options.map((sub_option) => {
                    const targetPath = `${linkPrefix}/${sub_option.id}`;
                    const finalHref = queryString ? `${targetPath}?${queryString}` : targetPath;

                    return (
                      <SidemenuNavItem
                        key={sub_option.id}
                        href={finalHref}
                        label={sub_option.label}
                        isActive={_checkIsActive(sub_option.id)}
                        isDesktopCollapsed={isDesktopCollapsed}
                        icon={iconDictionary[sub_option.iconName]}
                        onMobileClick={() => setIsMobileOpen(false)}
                      />
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

        <SidemenuFooter
          isDesktopCollapsed={isDesktopCollapsed}
          onToggleDesktopMenu={_toggleDesktopMenu}
          onSignOut={onSignOut}
        />
      </aside>
    </>
  );
}
