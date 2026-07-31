"use client";

import { At, Bars, CircleInfo, Eye, Pencil, Persons } from "@gravity-ui/icons";

import { Dropdown, Label, Separator } from "@heroui/react";

import ThemeSwitch from "../../ui/ThemeSwitch";

export default function TopNavLinksDropdown() {
  return (
    <>
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
            height={40}
            width={40}
          />
        </Dropdown.Trigger>

        {/* Modal (the default) on purpose: `isNonModal` was tried and reverted -- it sets
            react-aria's isDismissable to false, so clicking outside no longer closed the menu.
            The scroll lock briefly hides the page scrollbar while open, but react-aria reserves
            the gutter on <html> itself, so nothing shifts. */}
        <Dropdown.Popover
          placement="bottom end"
          className="-mt-1 w-[220px] rounded-xl">
          <Dropdown.Menu aria-label="Navigationslinks">
            {/* SECTION 1: Mobile-Only Links */}
            <Dropdown.Section
              className="lg:hidden"
              aria-label="Dashboard-Links">
              <Dropdown.Item
                id="dashboard"
                textValue="Saisonübersicht"
                href="/dashboard"
                className="flex w-full items-center justify-between rounded-md px-2 py-1.5">
                <Label className="text-fluid-sm text-foreground min-w-0 flex-1 font-semibold">Saisonübersicht</Label>
                <Eye className="text-foreground-muted size-4" />
              </Dropdown.Item>

              <Dropdown.Item
                id="admin"
                textValue="Verwalten"
                href="/admin"
                className="data-[hover=true]:bg-muted flex w-full items-center justify-between rounded-md px-2 py-1.5 transition-colors">
                <Label className="text-fluid-sm text-foreground min-w-0 flex-1 font-semibold">Verwalten</Label>
                <Pencil className="text-foreground-muted size-4" />
              </Dropdown.Item>
            </Dropdown.Section>

            <Separator className="my-1 lg:hidden" />

            {/* SECTION 2: Global Links */}
            <Dropdown.Section aria-label="Allgemeine Links">
              <Dropdown.Item
                id="about"
                textValue="About"
                href="/about"
                className="flex w-full items-center justify-between rounded-md px-2 py-1.5 transition-colors">
                <Label className="text-fluid-sm text-foreground min-w-0 flex-1 font-semibold">About</Label>
                <CircleInfo className="text-foreground-muted size-4" />
              </Dropdown.Item>

              <Dropdown.Item
                id="team"
                textValue="Team"
                href="/team"
                className="data-[hover=true]:bg-muted flex w-full items-center justify-between rounded-md px-2 py-1.5 transition-colors">
                <Label className="text-fluid-sm text-foreground min-w-0 flex-1 font-semibold">Team</Label>
                <Persons className="text-foreground-muted size-4" />
              </Dropdown.Item>

              <Dropdown.Item
                id="kontakt"
                textValue="Kontakt"
                href="/kontakt"
                className="data-[hover=true]:bg-muted flex w-full items-center justify-between rounded-md px-2 py-1.5 transition-colors">
                <Label className="text-fluid-sm text-foreground min-w-0 flex-1 font-semibold">Kontakt</Label>
                <At className="text-foreground-muted size-4" />
              </Dropdown.Item>
            </Dropdown.Section>

            <Separator className="my-1" />

            {/* SECTION 3: App Controls */}
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
    </>
  );
}
