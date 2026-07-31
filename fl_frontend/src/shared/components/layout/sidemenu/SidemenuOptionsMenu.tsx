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
 * `Dropdown.Trigger` renders the button itself (it wraps react-aria's `Button`), so the styling and
 * the accessible name go on it directly — nesting a `<button>` inside would be invalid HTML and
 * would swallow the press. It therefore reports `aria-expanded` for free, which the topnav's
 * raw-`<svg>` trigger does not (Wave 6, R4-2.1).
 */
export default function SidemenuOptionsMenu({ isDesktopCollapsed }: { isDesktopCollapsed: boolean }) {
  return (
    <Dropdown>
      <IconTooltip
        label="Weitere Optionen"
        placement="right"
        isEnabled={isDesktopCollapsed}>
        <Dropdown.Trigger
          aria-label="Weitere Optionen"
          className="text-foreground-muted hover:bg-muted hover:text-foreground flex h-9 w-9 shrink-0 items-center justify-center rounded-md p-0 transition-colors">
          <Ellipsis className="h-[18px] w-[18px]" />
        </Dropdown.Trigger>
      </IconTooltip>

      {/* placement="top start": the footer sits at the bottom of the viewport, so the menu drops up. */}
      <Dropdown.Popover
        placement="top start"
        className="mb-1 w-[220px] rounded-xl">
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
