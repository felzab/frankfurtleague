"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";

import { ArrowRightFromSquare, Ellipsis } from "@gravity-ui/icons";

import { Dropdown, Label, Separator, toast } from "@heroui/react";

import { useNavigationClosedOverlay } from "@/shared/hooks/useNavigationClosedOverlay";

import { IconTooltip } from "../../ui/IconTooltip";
import ThemeSwitch from "../../ui/ThemeSwitch";

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
  const router = useRouter();

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
            {/* `shouldCloseOnSelect={false}`: this row is a container for a control, not a command, so
                pressing it must not dismiss the menu the switch lives in.
                `data-menu-static` opts it out of the focused-option highlight — the row is not a
                choice, and flashing it brand on press looked like a selection had been made. */}
            <Dropdown.Item
              id="theme-switch"
              textValue="Modus"
              shouldCloseOnSelect={false}
              data-menu-static="true"
              className="flex w-full cursor-default items-center justify-between px-2 py-1.5 data-[hover=true]:bg-transparent">
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
                <Dropdown.Item
                  id="sign-out"
                  textValue="Abmelden"
                  isDisabled={isSigningOut}
                  onAction={handleSignOut}
                  className="data-[hover=true]:bg-danger/10 flex w-full items-center justify-between rounded-md px-2 py-1.5 transition-colors">
                  <Label className="text-fluid-sm text-danger min-w-0 flex-1 font-semibold">
                    {isSigningOut ? "Wird abgemeldet..." : "Abmelden"}
                  </Label>
                  <ArrowRightFromSquare
                    aria-hidden="true"
                    className="text-danger size-4"
                  />
                </Dropdown.Item>
              </Dropdown.Section>
            </>
          )}
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  );
}
