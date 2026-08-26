"use client";

import { Bars } from "@gravity-ui/icons";

import { BrandLink } from "../../ui/BrandLink";
import { InfoHint } from "../../ui/InfoHint";
import { ThemeSwitch } from "../../ui/ThemeSwitch";
import { RAIL_WIDTH_LG } from "./railWidth";
import { SignOutButton } from "./SignOutButton";

import type { FormState, SidemenuHint } from "@/shared/types/types";

/**
 * **This is the page's `h1` and a view under it must not carry a second.** `SidemenuStructure` is the one declaration
 * of a route's name, read by both the nav item and this title, so the two cannot disagree.
 */
export function AppTopBar({
  title,
  hint,
  isMobileOpen,
  onToggleMobileMenu,
  isDesktopCollapsed,
  onSignOut,
}: {
  title: string;
  /** The active route's `hint`, already resolved against the shell's fallback, so the glyph is a fixture of the bar. */
  hint?: SidemenuHint;
  isMobileOpen: boolean;
  onToggleMobileMenu: () => void;
  /** Only to size the brand block to the rail beneath it — the bar has no collapse control of its own. */
  isDesktopCollapsed: boolean;
  /** Forwarded to the options menu; only the admin shell supplies one. */
  onSignOut?: () => Promise<FormState>;
}) {
  // Hoisted out of the class template because the Tailwind lint cannot read a class string through an
  // index expression — it reads `collapsed` and `expanded` as class names.
  const railWidth = RAIL_WIDTH_LG[isDesktopCollapsed ? "collapsed" : "expanded"];

  return (
    <header className="bg-surface border-border z-30 flex h-(--navbar-height) w-full shrink-0 flex-row items-stretch border-b">
      {/* Exactly the rail's width, so the bar's `border-b` and the rail's `border-r` meet in a cross rather than a
          T. `transition-[width]` runs at the rail's own duration, or the bar snaps ahead of the panel. */}
      <div
        className={`border-border flex shrink-0 flex-row items-center gap-x-3 px-4 transition-[width] duration-300 ease-in-out lg:border-r ${
          railWidth
        } ${isDesktopCollapsed ? "lg:justify-center lg:px-0" : ""}`}>
        {/* Opens the drawer and only opens it: the open panel overlays this bar, so the close control is
            `SidemenuDrawerHeader`'s. `aria-expanded` still reports the state for a screen reader. */}
        <button
          type="button"
          onClick={onToggleMobileMenu}
          aria-expanded={isMobileOpen}
          aria-controls="app-sidemenu"
          aria-label="Menü öffnen"
          className="text-foreground hover:bg-hover -ml-2 shrink-0 rounded-md p-1.5 transition-colors lg:hidden">
          <Bars
            aria-hidden="true"
            width={24}
            height={24}
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
        {/* `truncate` and not wrap: the bar is a fixed height, so a wrapped title is clipped mid-letter. The glyph
            sits inside the h1 to inherit its font size, so `InfoHint`'s 1em icon matches. */}
        <h1 className="fluid-base text-foreground min-w-0 truncate font-semibold tracking-wide">
          {title}
          {/* `InfoHint` rather than `IconTooltip`: react-aria's tooltip never opens on tap, so a phone could not reach it. */}
          {hint && (
            <InfoHint label={`Was auf „${title}“ zu finden ist`}>
              <p>
                <strong>{title}</strong>
              </p>
              <p>{hint.lead}</p>
              {hint.points && (
                <ul>
                  {hint.points.map((point) => (
                    <li key={point.term}>
                      <strong>{point.term}</strong>: {point.detail}
                    </li>
                  ))}
                </ul>
              )}
              {hint.note && <p className="text-foreground-muted">{hint.note}</p>}
            </InfoHint>
          )}
        </h1>

        {/* Inline rather than behind a menu, so ending a session does not need the drawer opened first. Inside this
            block rather than beside it, so the pair takes the same inset the title does. */}
        <div className="ms-auto flex shrink-0 flex-row items-center gap-x-4">
          {/* From `lg` only: a phone's bar has no room for a fourth control, and the sidemenu footer's options
              menu carries this one at every width. */}
          <span className="hidden lg:flex">
            <ThemeSwitch />
          </span>
          {onSignOut && <SignOutButton onSignOut={onSignOut} />}
        </div>
      </div>
    </header>
  );
}
