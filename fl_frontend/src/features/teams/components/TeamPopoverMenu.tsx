"use client";

import Link from "next/link";

import { CircleInfo, Persons } from "@gravity-ui/icons";

import { Badge, Popover, Separator } from "@heroui/react";

import { TBD_TEAM_SHORTHAND } from "../constants";

export default function TeamPopoverMenu({
  teamName,
  teamId,
  teamShorthand,
  teamIsDisqualified,
  children,
}: {
  teamName: string;
  teamId: string;
  teamShorthand: string;
  teamIsDisqualified?: boolean;
  children: React.ReactNode;
}) {
  const isTbdTeam = teamShorthand === TBD_TEAM_SHORTHAND;
  return (
    <div
      className="contents"
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}>
      <Popover>
        <Popover.Trigger>
          <button className="hover:text-brand focus-visible:text-brand relative flex w-fit cursor-pointer items-center text-left transition-colors duration-200 outline-none">
            <Badge.Anchor className="w-fit">{children}</Badge.Anchor>
          </button>
        </Popover.Trigger>

        <Popover.Content
          placement="right"
          offset={10}>
          <Popover.Dialog className="bg-surface border-border text-foreground rounded-xl border p-4 shadow-lg outline-none">
            <Popover.Arrow className="fill-surface" />

            <Popover.Heading className="text-fluid-base flex w-full flex-row items-center justify-between font-bold">
              <span className="truncate pr-2">{teamName}</span>
              {teamIsDisqualified && (
                <span className="bg-danger/10 text-danger rounded-md px-2 py-0.5 text-xs font-extrabold uppercase">DQ</span>
              )}
            </Popover.Heading>

            <Separator
              orientation="horizontal"
              className="bg-border my-3 h-[1px] w-full"
            />

            {/* Links */}
            <div className="text-fluid-sm flex size-full flex-col gap-y-1">
              {/* TEAM-DETAILS */}
              {isTbdTeam ? (
                <span
                  aria-disabled="true"
                  className="text-foreground-muted flex w-full cursor-not-allowed flex-row items-center gap-x-2.5 rounded-lg px-2.5 py-2 font-semibold opacity-50">
                  <CircleInfo
                    className="text-brand shrink-0"
                    width={18}
                    height={18}
                  />
                  <span>Team-Details</span>
                </span>
              ) : (
                <Link
                  prefetch={false}
                  href={`/dashboard/teams/${teamId}`}
                  className="hover:bg-muted text-foreground-muted hover:text-foreground flex w-full flex-row items-center gap-x-2.5 rounded-lg px-2.5 py-2 font-semibold transition-colors">
                  <CircleInfo
                    className="text-brand shrink-0"
                    width={18}
                    height={18}
                  />
                  <span>Team-Details</span>
                </Link>
              )}

              {/* KADER */}
              {isTbdTeam ? (
                <span
                  aria-disabled="true"
                  className="text-foreground-muted flex w-full cursor-not-allowed flex-row items-center gap-x-2.5 rounded-lg px-2.5 py-2 font-semibold opacity-50">
                  <Persons
                    className="text-brand shrink-0"
                    width={18}
                    height={18}
                  />
                  <span>Kader</span>
                </span>
              ) : (
                <Link
                  prefetch={false}
                  href={`/dashboard/spieler/${teamId}`}
                  className="hover:bg-muted text-foreground-muted hover:text-foreground flex w-full flex-row items-center gap-x-2.5 rounded-lg px-2.5 py-2 font-semibold transition-colors">
                  <Persons
                    className="text-brand shrink-0"
                    width={18}
                    height={18}
                  />
                  <span>Kader</span>
                </Link>
              )}
            </div>
          </Popover.Dialog>
        </Popover.Content>
      </Popover>
    </div>
  );
}
