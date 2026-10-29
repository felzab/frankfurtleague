"use client";

// Redesign: goes with its last importer; `kit/RailFrame` replaces it.
import { Suspense } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import Bars from "@gravity-ui/icons/Bars";
import PersonGear from "@gravity-ui/icons/PersonGear";

import { BrandLink } from "../../ui/BrandLink";
import { ThemeSwitch } from "../../ui/ThemeSwitch";
import { KONTO_SECTION } from "./kontoSection";
import { RAIL_WIDTH_LG_CLASSES } from "./railWidth";
import { SignOutButton } from "./SignOutButton";

import type { SignOutResult } from "@/shared/types/types";
import type React from "react";

export function AppTopBar({
  heading,
  isMobileOpen,
  onToggleMobileMenu,
  isDesktopCollapsed,
  kontoHref,
  onSignOut,
}: {
  /** The page's `h1` and its hint (`fl_frontend/src/shared/components/layout/shell/ShellHeading.tsx :: ShellTitle`). */
  heading: React.ReactNode;
  isMobileOpen: boolean;
  onToggleMobileMenu: () => void;
  /** Only to size the brand block to the rail beneath it — the bar has no collapse control of its own. */
  isDesktopCollapsed: boolean;
  /** The person's account page, `null` in a shell no session stands behind. */
  kontoHref: string | null;
  /** Forwarded to the options menu; a shell for the public dashboard supplies none. */
  onSignOut?: () => Promise<SignOutResult>;
}) {
  // Hoisted out of the class template because the Tailwind lint cannot read a class string through an
  // index expression — it reads `collapsed` and `expanded` as class names.
  const railWidth = RAIL_WIDTH_LG_CLASSES[isDesktopCollapsed ? "collapsed" : "expanded"];

  return (
    /* `inert` with `<main>` and for its reason: the open drawer covers the left of this bar and the
       dismiss layer the rest, so nothing here is a stop the reader can see (WCAG 2.4.11). */
    /* `box-content`, as the public bar is (`fl_frontend/src/shared/components/layout/shell/PublicShell.tsx`):
       the border sits outside the token on both, so a move between them shifts nothing by a pixel. */
    <header
      inert={isMobileOpen}
      className="z-30 box-content flex h-(--navbar-height) w-full shrink-0 flex-row items-stretch border-b border-border bg-surface">
      {/* Exactly the rail's width, so the bar's `border-b` and the rail's `border-r` meet in a cross rather than a
          T. `transition-[width]` runs at the rail's own duration, or the bar snaps ahead of the panel. */}
      <div
        className={`flex shrink-0 flex-row items-center gap-x-3 border-border px-4 transition-[width] duration-300 ease-in-out motion-reduce:transition-none lg:border-r ${
          railWidth
        } ${isDesktopCollapsed ? "lg:justify-center lg:px-0" : ""}`}>
        {/* Opens the drawer and only opens it: the bar goes inert with `<main>` while the panel is open and
            `SidemenuDrawerHeader`'s control closes it, so `Menü öffnen` names the one press on offer here. */}
        <button
          type="button"
          onClick={onToggleMobileMenu}
          aria-expanded={isMobileOpen}
          aria-controls="app-sidemenu"
          aria-label="Menü öffnen"
          className="-ml-2 shrink-0 rounded-md p-1.5 text-foreground transition-colors hover:bg-hover lg:hidden">
          <Bars
            className="size-6"
            aria-hidden="true"
          />
        </button>

        {/* No brand below `lg`, where this block is the hamburger and the mark lives at the top of the drawer
            it opens. From `lg` the rail is permanent and this block is its width. */}
        <BrandLink
          title="Zur öffentlichen Website"
          hideName={isDesktopCollapsed}
          className="hidden min-w-0 shrink-0 lg:flex"
        />
      </div>

      {/* No left padding below `lg`: the brand block's own `px-4` is already the gutter, and a second one doubles
          it on a narrow screen. From `lg` a border separates the two blocks, so each wants its own inset. */}
      <div className="flex min-w-0 flex-1 flex-row items-center gap-x-3 pe-4 lg:ps-4">
        {/* `truncate` and not wrap: the bar is a fixed height, so a wrapped title is clipped mid-letter. */}
        <div className="min-w-0 truncate fluid-base">{heading}</div>

        {/* Inline rather than behind a menu, so ending a session does not need the drawer opened first. Inside this
            block rather than beside it, so the pair takes the same inset the title does. */}
        <div className="ms-auto flex shrink-0 flex-row items-center gap-x-4">
          {/* From `lg` only: a phone's bar has no room for a fourth control, and the sidemenu footer's options
              menu carries this one at every width. */}
          <span className="hidden lg:flex">
            <ThemeSwitch />
          </span>
          {/* From `lg` only, for the theme switch's reason: below it the drawer's options menu carries the
              same address. */}
          {kontoHref !== null && (
            <span className="hidden lg:flex">
              {/* The link itself in the boundary's stead, unmarked: only its current mark reads the address. */}
              <Suspense
                fallback={
                  <KontoLink
                    href={kontoHref}
                    isCurrent={false}
                  />
                }>
                <KontoLinkAtAddress href={kontoHref} />
              </Suspense>
            </span>
          )}
          {onSignOut && <SignOutButton onSignOut={onSignOut} />}
        </div>
      </div>
    </header>
  );
}

/** Under a Suspense boundary only, for `ShellHeading`'s reason. */
function KontoLinkAtAddress({ href }: { href: string }) {
  return (
    <KontoLink
      href={href}
      isCurrent={usePathname() === href}
    />
  );
}

function KontoLink({ href, isCurrent }: { href: string; isCurrent: boolean }) {
  return (
    <Link
      href={href}
      aria-current={isCurrent ? "page" : undefined}
      className="flex h-9 shrink-0 items-center gap-x-2 rounded-md px-2 fluid-sm font-semibold text-foreground transition-colors hover:bg-hover">
      <PersonGear
        aria-hidden="true"
        className="size-4.5 shrink-0"
      />
      {KONTO_SECTION.label}
    </Link>
  );
}
