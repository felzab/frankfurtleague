import Link from "next/link";

import At from "@gravity-ui/icons/At";
import CircleInfo from "@gravity-ui/icons/CircleInfo";
import Eye from "@gravity-ui/icons/Eye";
import Person from "@gravity-ui/icons/Person";
import Persons from "@gravity-ui/icons/Persons";

import { Dropdown } from "@heroui/react/dropdown";
import { Label } from "@heroui/react/label";
import { Separator } from "@heroui/react/separator";

import { ABOUT_TITEL, DEIN_BEREICH_TITEL, KONTAKT_TITEL, ORGANISATION_TITEL, SAISONUEBERSICHT_TITEL } from "@/core/seitenNamen";

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
            className="rounded-full px-4 py-1.5 fluid-sm font-semibold text-foreground transition-colors hover:bg-hover">
            {SAISONUEBERSICHT_TITEL}
          </Link>

          {/* To everyone, as the chrome of a public page knows no session: a visitor signed in nowhere is
              sent on to the sign-in by the area's own guard. */}
          <Link
            href="/bereich"
            className="rounded-full px-4 py-1.5 fluid-sm font-semibold text-foreground transition-colors hover:bg-hover">
            {DEIN_BEREICH_TITEL}
          </Link>
        </div>

        {/* Outside the link group, so the row's own gap parts it from both neighbours rather than
            one gap plus a margin. */}
        <div
          className="hidden h-8 w-px bg-border lg:block"
          aria-hidden="true"
        />

        <TopNavLinksDropdown>
          <Dropdown.Section
            className="lg:hidden"
            aria-label="Dashboard-Links">
            <Dropdown.Item
              id="dashboard"
              textValue={SAISONUEBERSICHT_TITEL}
              href="/dashboard"
              className="flex w-full items-center justify-between rounded-md px-2 py-1.5 transition-colors data-hovered:bg-hover">
              <Label className="min-w-0 flex-1 fluid-sm font-semibold text-foreground">{SAISONUEBERSICHT_TITEL}</Label>
              <Eye
                aria-hidden="true"
                className="size-4 text-foreground-muted"
              />
            </Dropdown.Item>

            <Dropdown.Item
              id="bereich"
              textValue={DEIN_BEREICH_TITEL}
              href="/bereich"
              className="flex w-full items-center justify-between rounded-md px-2 py-1.5 transition-colors data-hovered:bg-hover">
              <Label className="min-w-0 flex-1 fluid-sm font-semibold text-foreground">{DEIN_BEREICH_TITEL}</Label>
              <Person
                aria-hidden="true"
                className="size-4 text-foreground-muted"
              />
            </Dropdown.Item>
          </Dropdown.Section>

          <Separator className="my-1 lg:hidden" />

          <Dropdown.Section aria-label="Allgemeine Links">
            <Dropdown.Item
              id="about"
              textValue={ABOUT_TITEL}
              href="/about"
              className="flex w-full items-center justify-between rounded-md px-2 py-1.5 transition-colors data-hovered:bg-hover">
              <Label className="min-w-0 flex-1 fluid-sm font-semibold text-foreground">{ABOUT_TITEL}</Label>
              <CircleInfo
                aria-hidden="true"
                className="size-4 text-foreground-muted"
              />
            </Dropdown.Item>

            <Dropdown.Item
              id="organisation"
              textValue={ORGANISATION_TITEL}
              href="/organisation"
              className="flex w-full items-center justify-between rounded-md px-2 py-1.5 transition-colors data-hovered:bg-hover">
              <Label className="min-w-0 flex-1 fluid-sm font-semibold text-foreground">{ORGANISATION_TITEL}</Label>
              <Persons
                aria-hidden="true"
                className="size-4 text-foreground-muted"
              />
            </Dropdown.Item>

            <Dropdown.Item
              id="kontakt"
              textValue={KONTAKT_TITEL}
              href="/kontakt"
              className="flex w-full items-center justify-between rounded-md px-2 py-1.5 transition-colors data-hovered:bg-hover">
              <Label className="min-w-0 flex-1 fluid-sm font-semibold text-foreground">{KONTAKT_TITEL}</Label>
              <At
                aria-hidden="true"
                className="size-4 text-foreground-muted"
              />
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
              <Label className="min-w-0 flex-1 fluid-sm font-semibold text-foreground">Modus</Label>
              <ThemeSwitch compact />
            </Dropdown.Item>
          </Dropdown.Section>
        </TopNavLinksDropdown>
      </div>
    </nav>
  );
}
