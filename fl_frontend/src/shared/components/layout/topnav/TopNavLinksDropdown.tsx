"use client";

import { Bars } from "@gravity-ui/icons";

import { Dropdown } from "@heroui/react";

/**
 * Only the Dropdown machinery is client-side: the menu's contents are inert markup arriving as `children` from a Server
 * Component, and react-aria's collection builder walks them on the client where they are ordinary elements again.
 */
export function TopNavLinksDropdown({ children }: { children: React.ReactNode }) {
  return (
    <Dropdown>
      {/* `Dropdown.Trigger` already renders a react-aria `Button`, so the accessible name belongs on it: labelling
          the inner `<svg>` names a graphic, and a nested `<Button>` is a button in a button. */}
      <Dropdown.Trigger
        aria-label="Navigationsmenü öffnen"
        className="text-foreground data-hovered:bg-hover rounded-md p-1 transition-colors">
        <Bars
          aria-hidden="true"
          height={28}
          width={28}
        />
      </Dropdown.Trigger>

      {/* Modal, the default, on purpose: `isNonModal` sets react-aria's `isDismissable` to false, so clicking
          outside stops closing the menu. */}
      <Dropdown.Popover
        placement="bottom end"
        className="-mt-1 w-[220px] rounded-xl">
        <Dropdown.Menu aria-label="Navigationslinks">{children}</Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  );
}
