"use client";

import { Bars } from "@gravity-ui/icons";

import { Dropdown } from "@heroui/react";

/**
 * Only the Dropdown machinery is client-side. The menu's contents are inert markup and arrive as
 * `children` from `TopNav`, which is a Server Component — the same inversion `Sidemenu` uses for
 * `saisonMetadataDisplay` (R3a §A4.2). React Aria's collection builder walks those children on the
 * client, where they are ordinary elements again, so `Dropdown.Section` / `Dropdown.Item` register
 * exactly as they did when they were declared here.
 */
export function TopNavLinksDropdown({ children }: { children: React.ReactNode }) {
  return (
    <Dropdown>
      {/* The label and the styling belong on the trigger, not on the icon (R4 §2.1).
          `Dropdown.Trigger` already renders a react-aria `Button` — verified in HeroUI 3.2.2,
          `dropdown.js` — so it is the element that carries the role and the `aria-expanded`
          MenuTrigger wires up. The old markup labelled the inner `<svg>` and gave it `tabIndex={0}`,
          which named a graphic and put a second tab stop inside the button while leaving the
          button itself nameless. Do not wrap a `<Button>` in here: that nests a button in a button
          (ledger NEW-F8). */}
      <Dropdown.Trigger
        aria-label="Navigationsmenü öffnen"
        className="text-foreground hover:bg-muted rounded-md p-1 transition-colors">
        <Bars
          aria-hidden="true"
          height={28}
          width={28}
        />
      </Dropdown.Trigger>

      {/* Modal (the default) on purpose: `isNonModal` was tried and reverted -- it sets
          react-aria's isDismissable to false, so clicking outside no longer closed the menu.
          The scroll lock briefly hides the page scrollbar while open, but react-aria reserves
          the gutter on <html> itself, so nothing shifts. */}
      <Dropdown.Popover
        placement="bottom end"
        className="-mt-1 w-[220px] rounded-xl">
        <Dropdown.Menu aria-label="Navigationslinks">{children}</Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  );
}
