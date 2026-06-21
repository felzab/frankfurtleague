"use client";

import { Badge, Popover, Separator } from "@heroui/react";
import Link from "next/link";
import { CircleInfo, Persons } from "@gravity-ui/icons";

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
          <button className="relative flex items-center w-fit text-left cursor-pointer outline-none hover:opacity-70 transition-opacity">
            <Badge.Anchor className="w-fit">{children}</Badge.Anchor>
          </button>
        </Popover.Trigger>

        <Popover.Content
          placement="right"
          offset={10}>
          <Popover.Dialog>
            <Popover.Arrow />
            <Popover.Heading className="flex flex-row justify-between w-full text-fluid-base font-bold">
              {teamName}
              {teamIsDisqualified && <span className="text-danger">DQ</span>}
            </Popover.Heading>
            <Separator
              orientation="horizontal"
              className=" bg-text-black dark:bg-text-white brightness-75 mt-2"
            />
            {/* Links / Actions */}
            <div className="flex flex-col items-center size-full gap-y-3 text-fluid-sm pt-3 pr-2">
              <Link
                prefetch={false}
                href={`/dashboard/teams/${teamId}`}
                className="flex flex-row items-center gap-x-2 w-full font-semibold">
                <CircleInfo /> <span className="text-quaternary-light dark:text-quaternary-dark">Team-Details</span>
              </Link>

              <Link
                prefetch={false}
                href={`/dashboard/spieler/${teamId}`}
                className="flex flex-row items-center gap-x-2 w-full font-semibold ">
                <Persons /> <span className="text-quaternary-light dark:text-quaternary-dark">Spieler / Kader</span>
              </Link>
            </div>
          </Popover.Dialog>
        </Popover.Content>
      </Popover>
    </div>
  );
}
