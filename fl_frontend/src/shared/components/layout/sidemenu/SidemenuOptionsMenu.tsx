"use client";

import { useState } from "react";

import { ArrowRightFromSquare, Ellipsis } from "@gravity-ui/icons";

import { Dropdown, Label, Separator } from "@heroui/react";

import { useNavigationClosedOverlay } from "@/shared/hooks/useNavigationClosedOverlay";
import { useSignOut } from "@/shared/hooks/useSignOut";

import { IconTooltip } from "../../ui/IconTooltip";
import { ThemeSwitch } from "../../ui/ThemeSwitch";

import type { FormState } from "@/shared/types/types";

/**
 * The sidemenu's options menu, opening upward from the footer.
 *
 * The shell's bar offers the same two controls inline (ADR-0046); this is a second placement, and the
 * sign-out's behaviour is `useSignOut`'s so the two cannot come to mean different things. **The
 * appearance is not shared, deliberately**: a full-width row in a 220px menu and a compact button on
 * a 54px bar are different shapes for the same action, and forcing one component to be both is what
 * makes a control look wrong in one of its homes.
 *
 * Layout follows the standard sidebar-footer menu (shadcn's `SidebarFooter` + dropdown, as used in
 * Vercel's dashboard template): expanded, the trigger is a full-width row and the menu opens above it
 * at the row's own width, so it is contained by construction. Collapsed, the rail is 72px and no
 * useful menu fits inside it, so the menu opens beside the rail instead — also the standard.
 *
 * `Dropdown.Trigger` renders the button itself (it wraps react-aria's `Button`), so the styling and
 * the accessible name go on it directly — nesting a `<button>` inside would be invalid HTML and would
 * swallow the press. It therefore reports `aria-expanded` for free.
 */
export function SidemenuOptionsMenu({
  isDesktopCollapsed,
  onSignOut,
}: {
  isDesktopCollapsed: boolean;
  /**
   * Injected by the shell that has a session to end — `shared` cannot import from `features`, and its
   * presence is the gate: the dashboard shell passes nothing and gets no sign-out item.
   */
  onSignOut?: () => Promise<FormState>;
}) {
  const { isOpen, setIsOpen } = useNavigationClosedOverlay();

  return (
    <Dropdown
      isOpen={isOpen}
      onOpenChange={setIsOpen}>
      <IconTooltip
        label="Weitere Optionen"
        placement="right"
        isEnabled={isDesktopCollapsed}>
        {/* `transform-none` when pressed cancels HeroUI's `.dropdown__trigger` `scale(0.97)`. That
            reads fine on an icon button but wrong on a full-width row. Note `scale-100` would NOT
            work: Tailwind v4 emits the standalone `scale` property, which composes with `transform`
            rather than replacing it, so the 0.97 would survive. */}
        <Dropdown.Trigger
          aria-label="Weitere Optionen"
          className={`text-foreground-muted data-hovered:bg-hover data-hovered:text-foreground flex h-9 shrink-0 items-center rounded-md transition-colors data-[pressed=true]:transform-none ${
            isDesktopCollapsed ? "w-9 justify-center p-0" : "w-full justify-start gap-2.5 px-3"
          }`}>
          <Ellipsis className="h-[18px] w-[18px] shrink-0" />
          {!isDesktopCollapsed && <span className="fluid-sm font-medium">Optionen</span>}
        </Dropdown.Trigger>
      </IconTooltip>

      {/* Expanded: `top` centres the menu on a trigger that already spans the sidemenu, and the width
          matches the footer's content box (sidemenu minus its p-3), so the menu cannot spill into the
          content area. Collapsed: no 220px menu fits in a 72px rail, so it opens beside it. */}
      {/* `offset` rather than a margin class: it feeds react-aria's positioning maths, so the gap is
          measured from the trigger in whichever direction the menu ends up opening. */}
      <Dropdown.Popover
        offset={8}
        placement={isDesktopCollapsed ? "right bottom" : "top"}
        /* Below `lg` the menu takes the viewport less a 1rem margin rather than matching
           the drawer, which cramps both rows. It is portalled, so overhanging costs
           nothing; from `lg` it matches the footer's content box. */
        className={`min-w-[250px] rounded-xl ${isDesktopCollapsed ? "w-[220px]" : "w-[calc(100vw-2rem)] lg:w-[calc(var(--width-sidemenu)-1.5rem)]"}`}>
        <Dropdown.Menu aria-label="Seitenmenü-Optionen">
          <Dropdown.Section aria-label="Einstellungen">
            {/* `shouldCloseOnSelect={false}`: this row is a container for a control, not a command,
                so pressing it must not dismiss the menu the switch lives in.

                **`bg-transparent!` with no state variant at all, which is the only spelling that
                holds.** Cancelling `data-hovered` left the row tinting through `data-focused` — a menu
                moves focus with the pointer, so `globals.css`'s unlayered
                `[data-slot="menu-item"][data-focused="true"]` fill arrived by an attribute the
                override never named — and cancelling both still leaves whatever attribute the next
                HeroUI release paints on. This row is a container for a control, never a command being
                chosen, so its background is a constant rather than a list of states to keep chasing.
                The `!` is what outranks the unlayered rule. */}
            <Dropdown.Item
              id="theme-switch"
              textValue="Modus"
              shouldCloseOnSelect={false}
              className="flex w-full cursor-default items-center justify-between bg-transparent! px-2 py-1.5">
              <Label className="fluid-sm text-foreground min-w-0 flex-1 font-semibold">Modus</Label>
              <ThemeSwitch compact />
            </Dropdown.Item>
          </Dropdown.Section>

          {/* Admin only — the dashboard shell has no session to end. */}
          {onSignOut && (
            <>
              <Separator className="my-1" />
              <Dropdown.Section aria-label="Konto">
                <SignOutItem
                  onSignOut={onSignOut}
                  isMenuOpen={isOpen}
                />
              </Dropdown.Section>
            </>
          )}
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  );
}

/**
 * The sign-out as one menu row: the whole row IS the control, which is what keeps the menu compact.
 *
 * Its own component only so the hook can live beside the state that resets it — arming is per-visit,
 * not sticky, and a menu reopened later must not still be one press away from ending the session.
 */
function SignOutItem({ onSignOut, isMenuOpen }: { onSignOut: () => Promise<FormState>; isMenuOpen: boolean }) {
  const { isConfirming, isSigningOut, press, disarm } = useSignOut(onSignOut);
  const [wasOpen, setWasOpen] = useState(isMenuOpen);

  // Adjusted during render rather than in an effect — React's documented pattern for resetting state
  // when something changes, and the one `react-hooks/set-state-in-effect` pushes you toward.

  // It also covers both directions at once, which an `onOpenChange` handler would not:
  // `useNavigationClosedOverlay` closes the menu on a route change by setting its own state, so that
  // path never reaches the handler.
  if (isMenuOpen !== wasOpen) {
    setWasOpen(isMenuOpen);
    disarm();
  }

  return (
    <Dropdown.Item
      id="sign-out"
      textValue={isConfirming ? "Abmelden?" : "Abmelden"}
      data-signout-control="true"
      isDisabled={isSigningOut}
      /* Without this the first press dismisses the menu and the second never happens, which is what
         makes an in-place confirm possible. Escaping stays easy: closing, Escape and clicking away
         all reset it, per the reset above. */
      shouldCloseOnSelect={false}
      onAction={press}
      /* **One red at rest, one when armed, nothing between**: a hover step competes with
         the state that matters. **`data-focused`, and important**, because an unlayered
         muted fill in `globals.css` otherwise paints grey over both. */
      className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 transition-colors ${
        isConfirming ? "bg-danger/20!" : "bg-danger/10!"
      }`}>
      {/* Armed, the row is its QUESTION and nothing else (decided 2026-08-07): the glyph goes and
          the label centres — one thing to read, no icon to mis-align against it. The tint and the
          label still both shift, so the state never rests on colour alone. */}
      <Label className={`fluid-sm text-danger min-w-0 flex-1 font-semibold ${isConfirming ? "text-center" : ""}`}>
        {isSigningOut ? "Wird abgemeldet..." : isConfirming ? "Abmelden?" : "Abmelden"}
      </Label>
      {!isConfirming && (
        <ArrowRightFromSquare
          aria-hidden="true"
          className="text-danger size-4 shrink-0"
        />
      )}
    </Dropdown.Item>
  );
}
