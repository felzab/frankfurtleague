import Link from "next/link";

import { At, CircleInfo, Eye, Pencil, Persons } from "@gravity-ui/icons";

import { Dropdown, Label, Separator } from "@heroui/react";

import { BrandLink } from "../../ui/BrandLink";
import { ThemeSwitch } from "../../ui/ThemeSwitch";
import { TopNavLinksDropdown } from "./TopNavLinksDropdown";

// Sync, with the dropdown rendered bare: it holds no hooks needing a request, so a Suspense boundary would
// guard nothing and add a resumable slot to the PPR shell.
export function TopNav() {
  return (
    <nav className="flex h-(--navbar-height) w-full items-center justify-between px-4">
      <BrandLink />

      <div className="flex items-center gap-2 sm:gap-3">
        <div className="hidden items-center gap-1 lg:flex">
          <Link
            href="/dashboard"
            className="fluid-sm text-foreground hover:bg-hover rounded-full px-4 py-1.5 font-semibold transition-colors">
            Saisonübersicht
          </Link>

          <Link
            href="/admin"
            className="fluid-sm text-foreground hover:bg-hover rounded-full px-4 py-1.5 font-semibold transition-colors">
            Verwalten
          </Link>
        </div>

        {/* Outside the link group, so the row's own gap parts it from both neighbours rather than
            one gap plus a margin. */}
        <div
          className="bg-border hidden h-8 w-px lg:block"
          aria-hidden="true"
        />

        <TopNavLinksDropdown>
          <Dropdown.Section
            className="lg:hidden"
            aria-label="Dashboard-Links">
            <Dropdown.Item
              id="dashboard"
              textValue="Saisonübersicht"
              href="/dashboard"
              className="data-hovered:bg-hover flex w-full items-center justify-between rounded-md px-2 py-1.5 transition-colors">
              <Label className="fluid-sm text-foreground min-w-0 flex-1 font-semibold">Saisonübersicht</Label>
              <Eye className="text-foreground-muted size-4" />
            </Dropdown.Item>

            <Dropdown.Item
              id="admin"
              textValue="Verwalten"
              href="/admin"
              className="data-hovered:bg-hover flex w-full items-center justify-between rounded-md px-2 py-1.5 transition-colors">
              <Label className="fluid-sm text-foreground min-w-0 flex-1 font-semibold">Verwalten</Label>
              <Pencil className="text-foreground-muted size-4" />
            </Dropdown.Item>
          </Dropdown.Section>

          <Separator className="my-1 lg:hidden" />

          <Dropdown.Section aria-label="Allgemeine Links">
            <Dropdown.Item
              id="about"
              textValue="About"
              href="/about"
              className="data-hovered:bg-hover flex w-full items-center justify-between rounded-md px-2 py-1.5 transition-colors">
              <Label className="fluid-sm text-foreground min-w-0 flex-1 font-semibold">About</Label>
              <CircleInfo className="text-foreground-muted size-4" />
            </Dropdown.Item>

            <Dropdown.Item
              id="organisation"
              textValue="Organisation"
              href="/organisation"
              className="data-hovered:bg-hover flex w-full items-center justify-between rounded-md px-2 py-1.5 transition-colors">
              <Label className="fluid-sm text-foreground min-w-0 flex-1 font-semibold">Organisation</Label>
              <Persons className="text-foreground-muted size-4" />
            </Dropdown.Item>

            <Dropdown.Item
              id="kontakt"
              textValue="Kontakt"
              href="/kontakt"
              className="data-hovered:bg-hover flex w-full items-center justify-between rounded-md px-2 py-1.5 transition-colors">
              <Label className="fluid-sm text-foreground min-w-0 flex-1 font-semibold">Kontakt</Label>
              <At className="text-foreground-muted size-4" />
            </Dropdown.Item>
          </Dropdown.Section>

          <Separator className="my-1" />

          <Dropdown.Section aria-label="Einstellungen">
            {/* See the identical row in `SidemenuOptionsMenu` for why this row neither closes nor tints. */}
            <Dropdown.Item
              id="theme-switch"
              textValue="Modus"
              shouldCloseOnSelect={false}
              className="flex w-full cursor-default items-center justify-between bg-transparent! px-2 py-1.5">
              <Label className="fluid-sm text-foreground min-w-0 flex-1 font-semibold">Modus</Label>
              <ThemeSwitch compact />
            </Dropdown.Item>
          </Dropdown.Section>
        </TopNavLinksDropdown>
      </div>
    </nav>
  );
}
