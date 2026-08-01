"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { ArrowRightFromSquare, Ellipsis, TriangleExclamation } from "@gravity-ui/icons";

import { Dropdown, Label, Separator, toast } from "@heroui/react";

import { useNavigationClosedOverlay } from "@/shared/hooks/useNavigationClosedOverlay";

import { IconTooltip } from "../../ui/IconTooltip";
import { ThemeSwitch } from "../../ui/ThemeSwitch";

import type { FormState } from "@/shared/types/types";

/**
 * The sidemenu's options menu, opening upward from the footer.
 *
 * Dashboard and admin have no topnav, so the theme switch that lives in `TopNavLinksDropdown` was
 * unreachable on those routes entirely. This is a menu rather than a bare switch because the footer
 * is the natural home for several of these — it now also carries the admin sign-out (NEW-S1) — and
 * the item markup matches the topnav dropdown so they stay one pattern.
 *
 * Layout follows the standard sidebar-footer menu (shadcn's `SidebarFooter` + dropdown, as used in
 * Vercel's dashboard template): expanded, the trigger is a full-width row and the menu opens above
 * it at the row's own width, so it is contained by construction. Collapsed, the rail is 72px and no
 * useful menu fits inside it, so the menu opens beside the rail instead — also the standard.
 *
 * `Dropdown.Trigger` renders the button itself (it wraps react-aria's `Button`), so the styling and
 * the accessible name go on it directly — nesting a `<button>` inside would be invalid HTML and
 * would swallow the press. It therefore reports `aria-expanded` for free, which the topnav's
 * raw-`<svg>` trigger does not (Wave 6, R4-2.1).
 */
export function SidemenuOptionsMenu({
  isDesktopCollapsed,
  onSignOut,
}: {
  isDesktopCollapsed: boolean;
  /**
   * Injected by the shell that has a session to end — `shared` cannot import from `features`, and
   * its presence is the gate: the dashboard shell passes nothing and gets no sign-out item.
   */
  onSignOut?: () => Promise<FormState>;
}) {
  const { isOpen, setIsOpen } = useNavigationClosedOverlay();
  const [isSigningOut, startSignOut] = useTransition();
  const [isConfirmingSignOut, setIsConfirmingSignOut] = useState(false);
  const [wasOpen, setWasOpen] = useState(isOpen);
  const router = useRouter();

  // Arming is per-visit, not sticky: a menu reopened later must not still be one press away from
  // ending the session.
  // Adjusted during render rather than in an effect — React's documented pattern for resetting state
  // when something changes, and the one `react-hooks/set-state-in-effect` exists to push you toward.
  // It also covers both directions at once, which an `onOpenChange` handler would not:
  // `useNavigationClosedOverlay` closes the menu on a route change by setting its own state, so that
  // path never reaches the handler.
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen);
    setIsConfirmingSignOut(false);
  }

  // The action returns rather than redirecting, so the navigation happens here — see the note on
  // `signOutAction`. The toast is fired BEFORE navigating: `Toast.Provider` is mounted once above
  // the router in `RootProviders`, so it survives the transition, whereas a toast queued after
  // `push()` races the unmount of this menu and was simply never seen.
  const handleSignOut = () => {
    startSignOut(async () => {
      try {
        const result = await onSignOut?.();

        if (result && !result.success) {
          toast.danger(result.error ?? "Abmelden fehlgeschlagen. Bitte versuche es erneut.");
          return;
        }

        toast.success(result?.message ?? "Erfolgreich abgemeldet.");
        // `refresh()` drops the cached server render of the admin shell just left behind.
        router.push("/");
        router.refresh();
      } catch {
        toast.danger("Abmelden fehlgeschlagen. Bitte versuche es erneut.");
      }
    });
  };

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
          className={`text-foreground-muted hover:bg-muted hover:text-foreground flex h-9 shrink-0 items-center rounded-md transition-colors data-[pressed=true]:transform-none ${
            isDesktopCollapsed ? "w-9 justify-center p-0" : "w-full justify-start gap-2.5 px-3"
          }`}>
          <Ellipsis className="h-[18px] w-[18px] shrink-0" />
          {!isDesktopCollapsed && <span className="text-fluid-sm font-medium">Optionen</span>}
        </Dropdown.Trigger>
      </IconTooltip>

      {/* Expanded: `top` centres the menu on a trigger that already spans the sidemenu, and the
          width matches the footer's content box (sidemenu minus its p-3), so the menu cannot spill
          into the content area. Collapsed: no 220px menu fits in a 72px rail, so it opens beside it. */}
      {/* `offset` rather than a margin class: it feeds react-aria's positioning maths, so the gap is
          measured from the trigger in whichever direction the menu ends up opening. */}
      <Dropdown.Popover
        offset={8}
        placement={isDesktopCollapsed ? "right bottom" : "top"}
        className={`rounded-xl ${isDesktopCollapsed ? "w-[220px]" : "w-[calc(var(--width-sidemenu)-1.5rem)]"}`}>
        <Dropdown.Menu aria-label="Seitenmenü-Optionen">
          <Dropdown.Section aria-label="Einstellungen">
            {/* `shouldCloseOnSelect={false}`: this row is a container for a control, not a command,
                so pressing it must not dismiss the menu the switch lives in. */}
            <Dropdown.Item
              id="theme-switch"
              textValue="Modus"
              shouldCloseOnSelect={false}
              className="flex w-full cursor-default items-center justify-between px-2 py-1.5 data-hovered:bg-transparent!">
              <Label className="text-fluid-sm text-foreground min-w-0 flex-1 font-semibold">Modus</Label>
              <ThemeSwitch />
            </Dropdown.Item>
          </Dropdown.Section>

          {/* Admin only — the dashboard shell has no session to end (ledger NEW-S1). Until this
              existed, `core/auth.ts`'s exported `signOut` had zero call sites and the only way to
              revoke a session was deleting its row from the `authjs` collection by hand. */}
          {onSignOut && (
            <>
              <Separator className="my-1" />
              <Dropdown.Section aria-label="Konto">
                {/* Confirms in place rather than in a modal (owner decision 2026-07-31): the first
                    press arms the row and the second signs out, so the question is answered where
                    the eye already is instead of in a dialog somewhere else on the screen.
                    `shouldCloseOnSelect={false}` is what makes it possible — without it the first
                    press dismisses the menu and the second never happens. The theme row above uses
                    the same escape hatch for the same structural reason.
                    Escaping is deliberately easy and undocumented-to-the-user: closing the menu,
                    pressing Escape or clicking away all reset it (see the render-time reset above). The only
                    path to signing out is a second, deliberate press on a row that has visibly
                    changed. */}
                <Dropdown.Item
                  id="sign-out"
                  textValue={isConfirmingSignOut ? "Wirklich abmelden?" : "Abmelden"}
                  isDisabled={isSigningOut}
                  shouldCloseOnSelect={false}
                  onAction={() => {
                    if (!isConfirmingSignOut) {
                      setIsConfirmingSignOut(true);
                      return;
                    }
                    handleSignOut();
                  }}
                  className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 transition-colors ${
                    isConfirmingSignOut ? "bg-danger/10 data-hovered:bg-danger/20" : "data-hovered:bg-danger/10"
                  }`}>
                  <Label className="text-fluid-sm text-danger min-w-0 flex-1 font-semibold">
                    {isSigningOut ? "Wird abgemeldet..." : isConfirmingSignOut ? "Wirklich abmelden?" : "Abmelden"}
                  </Label>
                  {/* The icon changes with the state so the row does not rely on colour alone to say
                      it is armed — the tint and the label both shift, and so does the glyph. */}
                  {isConfirmingSignOut ? (
                    <TriangleExclamation
                      aria-hidden="true"
                      className="text-danger size-4 shrink-0"
                    />
                  ) : (
                    <ArrowRightFromSquare
                      aria-hidden="true"
                      className="text-danger size-4 shrink-0"
                    />
                  )}
                </Dropdown.Item>
              </Dropdown.Section>
            </>
          )}
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  );
}
