"use client";

import Link from "next/link";

import { CircleInfo, Persons } from "@gravity-ui/icons";

import { Badge, Popover, Separator } from "@heroui/react";

export default function TeamPopoverMenu({
  teamName,
  teamId,
  teamIsDisqualified,
  children,
}: {
  teamName: string;
  teamId: string;
  teamIsDisqualified?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className="contents"
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}>
      <Popover>
        <Popover.Trigger>
          <button className="relative flex w-fit cursor-pointer items-center text-left transition-opacity outline-none hover:opacity-70">
            <Badge.Anchor className="w-fit">{children}</Badge.Anchor>
          </button>
        </Popover.Trigger>

        <Popover.Content
          placement="right"
          offset={10}>
          <Popover.Dialog>
            <Popover.Arrow />
            <Popover.Heading className="text-fluid-base flex w-full flex-row justify-between font-bold">
              {teamName}
              {teamIsDisqualified && <span className="text-danger">DQ</span>}
            </Popover.Heading>
            <Separator
              orientation="horizontal"
              className="bg-text-black dark:bg-text-white mt-2 brightness-75"
            />
            {/* Links / Actions */}
            <div className="text-fluid-sm flex size-full flex-col items-center gap-y-3 pt-3 pr-2">
              <Link
                prefetch={false}
                href={`/dashboard/teams/${teamId}`}
                className="flex w-full flex-row items-center gap-x-2 font-semibold">
                <CircleInfo /> <span className="text-quaternary-light dark:text-quaternary-dark">Team-Details</span>
              </Link>

              <Link
                prefetch={false}
                href={`/dashboard/spieler/${teamId}`}
                className="flex w-full flex-row items-center gap-x-2 font-semibold">
                <Persons /> <span className="text-quaternary-light dark:text-quaternary-dark">Spieler / Kader</span>
              </Link>
            </div>
          </Popover.Dialog>
        </Popover.Content>
      </Popover>
    </div>
  );
}
