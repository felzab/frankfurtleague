"use client";

import { Bars } from "@gravity-ui/icons";

import { BrandLink } from "../../ui/BrandLink";
import { InfoHint } from "../../ui/InfoHint";
import { ThemeSwitch } from "../../ui/ThemeSwitch";
import { RAIL_WIDTH_LG } from "./railWidth";
import { SignOutButton } from "./SignOutButton";

import type { FormState, SidemenuHint } from "@/shared/types/types";

/**
 * The shell's one bar, spanning the whole viewport above both the sidemenu and the content.
 *
 * **It is the page's `h1`, and the pages under it no longer carry one.** A route's name was
 * previously declared twice — once in the navigation structure, once as a heading inside whichever
 * view happened to render it — and the two were free to disagree; seven of those headings were
 * `sr-only`, which is a heading nobody could see and nobody would notice going stale.
 * `SidemenuStructure` is the single declaration now, and both the nav item and this title read it.
 *
 * **The brand sits here rather than in the sidemenu, and the reason is not the reference design.**
 * The mark belongs to the product and the navigation belongs to the section, so a bar that spans the
 * viewport is where a product mark goes — but the deciding cost was that the sidemenu owned two
 * different headers, one for the rail and one for the phone, and only the phone's carried the page
 * title. Collapsing them into this bar removes that divergence rather than papering over it.
 *
 * The wordmark hides below `lg` because the title has to fit beside it on a 375px screen; the mark
 * itself stays at every width, so the link home never moves.
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
  /** The active route's `hint`. Absent on a route the navigation does not name. */
  hint?: SidemenuHint;
  isMobileOpen: boolean;
  onToggleMobileMenu: () => void;
  /** Only to size the brand block to the rail beneath it — the bar has no collapse control of its own. */
  isDesktopCollapsed: boolean;
  /** Forwarded to the options menu; only the admin shell supplies one. */
  onSignOut?: () => Promise<FormState>;
}) {
  // The `lg:` width only: below `lg` this block is the hamburger and sizes to it, while the rail is a
  // full-width drawer. Hoisted out of the class template because the Tailwind lint cannot read a class
  // string through an index expression — it reads `collapsed` / `expanded` as class names.
  const railWidth = RAIL_WIDTH_LG[isDesktopCollapsed ? "collapsed" : "expanded"];

  return (
    <header className="bg-surface border-border z-30 flex h-(--navbar-height) w-full shrink-0 flex-row items-stretch border-b">
      {/* **The brand block is exactly the rail's width, and its right border is the rail's right
          border continued upward.** That is what makes the bar's `border-b` and the rail's
          `border-r` meet in a cross rather than in a T — the shell then reads as two columns with a
          header across them, which is the arrangement the reference dashboards use. It tracks the
          collapsed rail too, so the seam holds in both states; `transition-[width]` at the rail's own
          duration keeps the two edges together while it animates rather than letting the bar snap
          ahead of the panel. */}
      <div
        className={`border-border flex shrink-0 flex-row items-center gap-x-3 px-4 transition-[width] duration-300 ease-in-out lg:border-r ${
          railWidth
        } ${isDesktopCollapsed ? "lg:justify-center lg:px-0" : ""}`}>
        {/* Opens the drawer, and only opens it: below `lg` the panel overlays this bar, so while it is
            open this button is behind it and the close control is the drawer's own
            (`SidemenuDrawerHeader`). `aria-expanded` still reports the state, which is what a screen
            reader needs and what the glyph therefore does not have to carry. */}
        <button
          type="button"
          onClick={onToggleMobileMenu}
          aria-expanded={isMobileOpen}
          aria-controls="app-sidemenu"
          aria-label="Menü öffnen"
          className="text-foreground hover:bg-muted -ml-2 shrink-0 rounded-md p-1.5 transition-colors lg:hidden">
          <Bars
            aria-hidden="true"
            width={24}
            height={24}
          />
        </button>

        {/* **No brand on a phone at all** (owner): below `lg` this block is the hamburger and
            nothing else, and the mark lives at the top of the drawer that button opens — full logo
            and wordmark, as it was. Here it appears from `lg`, where the rail is permanent and the
            block is that rail's width; the collapsed rail is 72px and takes the mark alone. */}
        <BrandLink
          title="Zur öffentlichen Website"
          hideName={isDesktopCollapsed}
          className="hidden min-w-0 shrink-0 lg:flex"
        />
      </div>

      {/* No left padding below `lg`: the brand block's own `px-4` is already the gutter between the
          hamburger and the title, and a second one made that gap 32px on a 375px screen — space the
          title is short of long before anything else is. From `lg` the two blocks are separated by a
          border, so each wants its own inset. */}
      <div className="flex min-w-0 flex-1 flex-row items-center gap-x-3 pe-4 lg:ps-4">
        {/* `truncate` and not wrap: the bar is a fixed height, so a title that wrapped would be
            clipped mid-letter rather than pushed onto a second line. Every label in the two nav
            structures fits at every width the app supports; this is the guard for the next one. */}
        {/* The glyph lives INSIDE the h1, on the text's own baseline — the exact placement the
            editors' panel headings use, and the one where an icon truly aligns with text (owner,
            2026-08-07: closer to the title, aligned like the Spiel editor). It inherits the h1's
            font size, so `InfoHint`'s 1em icon matches, and its own `ms-1.5` is the whole gap. A
            title long enough to truncate would clip it — the fits-at-every-width guarantee above is
            what rules that out. */}
        <h1 className="fluid-base text-foreground min-w-0 truncate font-semibold tracking-wide">
          {title}
          {/* One glyph per page, and the shell owns it so no view has to remember to add one.
              `InfoHint` rather than `IconTooltip`, for the reason it is used everywhere else in the
              app: react-aria's tooltip opens on hover and focus and deliberately never on tap, so
              on a phone it would be unreachable. */}
          {hint && (
            <InfoHint label={`Was auf „${title}“ zu finden ist`}>
              {/* Three levels, always in this order: the page's name, one sentence saying what it is
                for, then the things on it — each as a bold term and its explanation. The term is what
                a reader scans, so it carries the weight and the detail does not. */}
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

        {/* **The two account controls, inline and not behind a menu** (owner). They lived in the
            sidemenu's footer, where on a phone they sat behind a shut drawer — so the appearance
            control and the only way to end a session both needed a navigation panel opened first.
            The bar has room for both, and a dropdown holding two items is a click in front of each.

            Inside this block rather than siblings of it, so they take the same `px-4` the title does
            and their gutter matches the one on the far side of the bar. `ms-auto` puts the pair at
            the end with no spacer element. */}
        <div className="ms-auto flex shrink-0 flex-row items-center gap-x-4">
          {/* **From `lg` only** (owner): on a phone the bar has the title, the glyph and the sign-out
              to fit, and the appearance control is the one of the four that is already reachable
              elsewhere — the sidemenu footer's options menu carries it at every width. */}
          <span className="hidden lg:flex">
            <ThemeSwitch />
          </span>
          {onSignOut && <SignOutButton onSignOut={onSignOut} />}
        </div>
      </div>
    </header>
  );
}
