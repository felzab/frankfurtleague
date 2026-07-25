"use client";

import { At, Bars, CircleInfo, Eye, Pencil, Persons } from "@gravity-ui/icons";

import { Dropdown, Label, Separator } from "@heroui/react";

import ThemeSwitch from "../../ui/ThemeSwitch";

export default function TopNavLinksDropdown() {
  return (
    <>
      <Dropdown>
        <Dropdown.Trigger>
          <Bars
            aria-label="Open navigation menu"
            height={40}
            className="text-foreground hover:bg-muted rounded-md p-1 transition-colors"
            tabIndex={0}
            width={40}
          />
        </Dropdown.Trigger>

        <Dropdown.Popover
          placement="bottom end"
          className="-mt-1 w-[220px] rounded-xl">
          <Dropdown.Menu aria-label="Navigation Links">
            {/* SECTION 1: Mobile-Only Links */}
            <Dropdown.Section
              className="lg:hidden"
              aria-label="Dashboard Links">
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
            <Dropdown.Section aria-label="General Links">
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
            <Dropdown.Section aria-label="Settings">
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
