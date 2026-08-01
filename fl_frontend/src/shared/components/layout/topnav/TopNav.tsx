import Link from "next/link";

import { At, CircleInfo, Eye, Pencil, Persons } from "@gravity-ui/icons";

import { Dropdown, Label, Separator } from "@heroui/react";

import { BrandLink } from "../../ui/BrandLink";
import { ThemeSwitch } from "../../ui/ThemeSwitch";
import { TopNavLinksDropdown } from "./TopNavLinksDropdown";

// Sync, and the dropdown is rendered bare: TopNavLinksDropdown holds no hooks that need a request
// and no data, so the Suspense that used to wrap it guarded nothing and only added a resumable slot
// to the PPR shell. The whole nav is part of the static shell now.
// `px-4` with no `sm:px-6`: the sidemenu's header is `px-4` at every width, so the two bars put the
// wordmark in the same place. Crossing between a public route and the dashboard used to shift it 8px
// to the left from `sm` up.
//
// The menu's six links live here rather than inside the client component (R3a §A4.2): they are
// static markup with no interactivity of their own, so this file renders them on the server and
// passes them down. `ThemeSwitch` is the one genuinely interactive leaf and stays a client island.
export function TopNav() {
  return (
    <nav className="flex h-(--navbar-height) w-full items-center justify-between px-4">
      {/* Brand Logo Area */}
      <BrandLink />

      {/* Navigation Links Area */}
      <div className="flex items-center gap-2 sm:gap-4">
        {/* Desktop Links (Hidden on Mobile) */}
        <div className="hidden items-center gap-1 lg:flex">
          <Link
            href="/dashboard"
            className="text-fluid-sm text-foreground hover:bg-muted rounded-full px-4 py-1.5 font-semibold transition-colors">
            Saisonübersicht
          </Link>

          <Link
            href="/admin"
            className="text-fluid-sm text-foreground hover:bg-muted rounded-full px-4 py-1.5 font-semibold transition-colors">
            Verwalten
          </Link>

          {/* Semantic Divider instead of an empty hardcoded div (We use this div instead of a HeroUI Separator because of performance)*/}
          <div
            className="bg-border ml-2 h-8 w-px"
            aria-hidden="true"
          />
        </div>

        <TopNavLinksDropdown>
          {/* SECTION 1: Mobile-Only Links */}
          <Dropdown.Section
            className="lg:hidden"
            aria-label="Dashboard-Links">
            <Dropdown.Item
              id="dashboard"
              textValue="Saisonübersicht"
              href="/dashboard"
              className="data-hovered:bg-muted flex w-full items-center justify-between rounded-md px-2 py-1.5 transition-colors">
              <Label className="text-fluid-sm text-foreground min-w-0 flex-1 font-semibold">Saisonübersicht</Label>
              <Eye className="text-foreground-muted size-4" />
            </Dropdown.Item>

            <Dropdown.Item
              id="admin"
              textValue="Verwalten"
              href="/admin"
              className="data-hovered:bg-muted flex w-full items-center justify-between rounded-md px-2 py-1.5 transition-colors">
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
              className="data-hovered:bg-muted flex w-full items-center justify-between rounded-md px-2 py-1.5 transition-colors">
              <Label className="text-fluid-sm text-foreground min-w-0 flex-1 font-semibold">About</Label>
              <CircleInfo className="text-foreground-muted size-4" />
            </Dropdown.Item>

            <Dropdown.Item
              id="team"
              textValue="Team"
              href="/team"
              className="data-hovered:bg-muted flex w-full items-center justify-between rounded-md px-2 py-1.5 transition-colors">
              <Label className="text-fluid-sm text-foreground min-w-0 flex-1 font-semibold">Team</Label>
              <Persons className="text-foreground-muted size-4" />
            </Dropdown.Item>

            <Dropdown.Item
              id="kontakt"
              textValue="Kontakt"
              href="/kontakt"
              className="data-hovered:bg-muted flex w-full items-center justify-between rounded-md px-2 py-1.5 transition-colors">
              <Label className="text-fluid-sm text-foreground min-w-0 flex-1 font-semibold">Kontakt</Label>
              <At className="text-foreground-muted size-4" />
            </Dropdown.Item>
          </Dropdown.Section>

          <Separator className="my-1" />

          {/* SECTION 3: App Controls */}
          <Dropdown.Section aria-label="Einstellungen">
            {/* See the identical row in `SidemenuOptionsMenu` for why this row does not close. */}
            <Dropdown.Item
              id="theme-switch"
              textValue="Modus"
              shouldCloseOnSelect={false}
              className="flex w-full cursor-default items-center justify-between px-2 py-1.5 data-hovered:bg-transparent!">
              <Label className="text-fluid-sm text-foreground min-w-0 flex-1 font-semibold">Modus</Label>
              <ThemeSwitch />
            </Dropdown.Item>
          </Dropdown.Section>
        </TopNavLinksDropdown>
      </div>
    </nav>
  );
}
