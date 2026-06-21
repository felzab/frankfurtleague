"use client";

import Link from "next/link";

import { At, Bars, CircleInfo, Eye, Pencil, Persons } from "@gravity-ui/icons";

import { Dropdown, Label, Separator } from "@heroui/react";

import ThemeSwitch from "../../ui/ThemeSwitch";

import type { Session } from "next-auth";

export default function TopNavLinksDropdown({ session }: { session: Session | null }) {
  return (
    <Dropdown>
      <Dropdown.Trigger>
        <Bars
          aria-label="Link dropdown"
          height={32}
          width={32}></Bars>
      </Dropdown.Trigger>
      <Dropdown.Popover className="w-full lg:w-fit">
        <Dropdown.Menu className="text-text-black dark:text-text-white text-fluid-sm font-semibold">
          {/** Primary links, only shown in this dropdown on mobile */}
          <Dropdown.Item
            id="dashboard"
            textValue="Saisonübersicht"
            className="w-full lg:hidden">
            <Link
              prefetch={false}
              title="Link to page: dashboard"
              href="/dashboard"
              className="flex w-full items-center justify-between">
              Saisonübersicht
              <Eye className="h-[16px] w-[16px]" />
            </Link>
          </Dropdown.Item>

          <Dropdown.Item
            id="verwalten"
            textValue="Verwalten"
            className="w-full lg:hidden">
            <Link
              prefetch={false}
              title="Link to page: verwalten"
              href={!session ? "/signin" : "/admin"}
              className="flex w-full items-center justify-between">
              Verwalten
              <Pencil className="size-3.5 lg:size-4.5" />
            </Link>
          </Dropdown.Item>

          <Separator className="lg:hidden" />

          <Dropdown.Item
            id="about"
            textValue="About"
            className="w-full">
            <Link
              title="Link to page: about"
              prefetch={false}
              href="/about"
              className="flex w-full items-center justify-between">
              About
              <CircleInfo className="size-3.5 lg:size-4.5" />
            </Link>
          </Dropdown.Item>

          <Dropdown.Item
            id="team"
            textValue="Team"
            className="w-full">
            <Link
              title="Link to page: team"
              prefetch={false}
              href="/team"
              className="flex w-full items-center justify-between">
              Team
              <Persons className="size-3.5 lg:size-4.5" />
            </Link>
          </Dropdown.Item>

          <Dropdown.Item
            id="kontakt"
            textValue="Kontakt"
            className="w-full">
            <Link
              title="Link to page: kontakt"
              prefetch={false}
              href="/kontakt"
              className="flex w-full items-center justify-between">
              Kontakt
              <At className="size-3.5 lg:size-4.5" />
            </Link>
          </Dropdown.Item>

          <Separator />

          <Dropdown.Item
            id="theme-switch"
            textValue="Theme-switch"
            shouldCloseOnSelect={false}
            className="flex w-full items-center justify-between">
            <Label className="text-text-black dark:text-text-white text-fluid-sm font-semibold">Modus</Label>

            <ThemeSwitch />
          </Dropdown.Item>
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  );
}
