"use client";

import { Ellipsis } from "@gravity-ui/icons";

import { Dropdown, Label } from "@heroui/react";

import { IconTooltip } from "../../ui/IconTooltip";
import ThemeSwitch from "../../ui/ThemeSwitch";

/**
 * The sidemenu's options menu, opening upward from the footer.
 *
 * Dashboard and admin have no topnav, so the theme switch that lives in `TopNavLinksDropdown` was
 * unreachable on those routes entirely. This is a menu rather than a bare switch because the footer
 * is the natural home for the next few of these — Wave 6's NEW-S1 sign-out is already queued for it
 * — and the item markup matches the topnav dropdown so they stay one pattern.
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
export function SidemenuOptionsMenu({ isDesktopCollapsed }: { isDesktopCollapsed: boolean }) {
  return (
    <Dropdown>
      <IconTooltip
        label="Weitere Optionen"
        placement="right"
        isEnabled={isDesktopCollapsed}>
        <Dropdown.Trigger
          aria-label="Weitere Optionen"
          className={`text-foreground-muted hover:bg-muted hover:text-foreground flex h-9 shrink-0 items-center rounded-md transition-colors ${
            isDesktopCollapsed ? "w-9 justify-center p-0" : "w-full justify-start gap-2.5 px-3"
          }`}>
          <Ellipsis className="h-[18px] w-[18px] shrink-0" />
          {!isDesktopCollapsed && <span className="text-fluid-sm font-medium">Optionen</span>}
        </Dropdown.Trigger>
      </IconTooltip>

      {/* Expanded: `top` centres the menu on a trigger that already spans the sidemenu, and the
          width matches the footer's content box (sidemenu minus its p-3), so the menu cannot spill
          into the content area. Collapsed: no 220px menu fits in a 72px rail, so it opens beside it. */}
      <Dropdown.Popover
        placement={isDesktopCollapsed ? "right bottom" : "top"}
        className={`rounded-xl ${isDesktopCollapsed ? "w-[220px]" : "mb-1 w-[calc(var(--width-sidemenu)-1.5rem)]"}`}>
        <Dropdown.Menu aria-label="Sidemenu Optionen">
          <Dropdown.Section aria-label="Einstellungen">
            <Dropdown.Item
              id="theme-switch"
              textValue="Modus"
              className="flex w-full cursor-default items-center justify-between px-2 py-1.5 data-[hover=true]:bg-transparent">
              <Label className="text-fluid-sm text-foreground min-w-0 flex-1 font-semibold">Modus</Label>
              <ThemeSwitch />
            </Dropdown.Item>
          </Dropdown.Section>
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  );
}
