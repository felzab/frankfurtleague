"use client";

import { Dropdown, Label, Separator } from "@heroui/react";
import Link from "next/link";
import { Session } from "next-auth";

import { CircleInfo, Bars, Eye, Persons, At, Pencil } from "@gravity-ui/icons";
import ThemeSwitch from "../../ui/ThemeSwitch";

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
        <Dropdown.Menu className="text-text-black dark:text-text-white font-semibold text-fluid-sm">
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
              <Eye className="w-[16px] h-[16px]" />
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
              <Pencil className="size-3.5" />
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
              href="/meta/about"
              className="flex w-full items-center justify-between">
              About
              <CircleInfo className="size-3.5" />
            </Link>
          </Dropdown.Item>

          <Dropdown.Item
            id="team"
            textValue="Team"
            className="w-full">
            <Link
              title="Link to page: team"
              prefetch={false}
              href="/meta/team"
              className="flex w-full items-center justify-between">
              Team
              <Persons className="size-3.5" />
            </Link>
          </Dropdown.Item>

          <Dropdown.Item
            id="kontakt"
            textValue="Kontakt"
            className="w-full">
            <Link
              title="Link to page: kontakt"
              prefetch={false}
              href="/meta/kontakt"
              className="flex w-full items-center justify-between">
              Kontakt
              <At className="size-3.5" />
            </Link>
          </Dropdown.Item>

          <Separator />

          <Dropdown.Item
            id="theme-switch"
            textValue="Theme-switch"
            shouldCloseOnSelect={false}
            className="flex w-full items-center justify-between">
            <Label className="text-text-black dark:text-text-white font-semibold text-fluid-sm">Modus</Label>

            <ThemeSwitch />
          </Dropdown.Item>
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  );
}
