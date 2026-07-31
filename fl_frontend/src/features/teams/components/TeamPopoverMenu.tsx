"use client";

import Link from "next/link";

import { CircleInfo, Persons } from "@gravity-ui/icons";

import { Badge, Popover, Separator } from "@heroui/react";

import { useNavigationClosedOverlay } from "@/shared/hooks/useNavigationClosedOverlay";

import { TBD_TEAM_SHORTHAND } from "../constants";

export default function TeamPopoverMenu({
  teamName,
  teamId,
  teamShorthand,
  teamIsDisqualified,
  placement = "right",
  surface = "default",
  children,
}: {
  teamName: string;
  teamId: string;
  teamShorthand: string;
  teamIsDisqualified?: boolean;
  /**
   * Defaults to `"right"`, which suits the cards: their triggers are truncated inside narrow grid
   * tracks, so one side always has room. Pass `"top"` where the trigger is wide and centred — with
   * a horizontal placement the width is the *main* axis, and react-aria only flips on that axis,
   * it never clamps to the viewport (`containerPadding` applies to the cross axis only). A vertical
   * placement moves width onto the cross axis, where it does get clamped.
   */
  placement?: "right" | "top";
  /**
   * The surface the trigger sits on, which is only about the focus border. `brand` is invisible on
   * the emerald field of `/about`, where the rest of the surface reads in `field-fg`.
   */
  surface?: "default" | "field";
  children: React.ReactNode;
}) {
  const isTbdTeam = teamShorthand === TBD_TEAM_SHORTHAND;
  const { isOpen, setIsOpen } = useNavigationClosedOverlay();

  return (
    <div
      className="contents"
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}>
      <Popover
        isOpen={isOpen}
        onOpenChange={setIsOpen}>
        {/* `min-w-0 max-w-full` on all three layers is what lets a caller's `truncate` work at all.
            Each one otherwise refuses to shrink and sizes itself to the full un-wrapped name:
            HeroUI's `.popover__trigger` is `inline-block`, so as a flex item it keeps the default
            `min-width:auto`; the button was `w-fit`; and `.badge-anchor` bakes in `shrink-0`, which
            `shrink` here undoes. The card only ever constrained its own grid cell, so the overflow
            happened inside this wrapper and the name spilled past the card edge. */}
        <Popover.Trigger className="max-w-full min-w-0">
          {/* type="button" is load-bearing: a typeless button defaults to submit, so mounting this
              anywhere inside a <form> would make opening the popover submit the form.

              This is the most repeated interactive element in the app — one per row of the season
              table, both teams on every match card — and a colour shift alone was not a focus
              indicator, because it is the same shift `hover:` makes (R4 §2.3). The border is
              transparent at rest, so it changes no layout. */}
          <button
            type="button"
            className={`hover:text-brand focus-visible:text-brand relative flex max-w-full min-w-0 cursor-pointer items-center rounded border border-transparent text-left transition-colors duration-200 outline-none ${
              surface === "field" ? "focus-visible:border-field-fg" : "focus-visible:border-brand"
            }`}>
            <Badge.Anchor className="max-w-full min-w-0 shrink">{children}</Badge.Anchor>
          </button>
        </Popover.Trigger>

        <Popover.Content
          placement={placement}
          offset={10}>
          {/* max-w caps the panel: nothing else constrains it, so without this the dialog grows to
              the full team name and a long one pushes it past the viewport edge. */}
          <Popover.Dialog className="bg-surface border-border text-foreground w-max max-w-[280px] rounded-xl border p-4 shadow-lg outline-none">
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
                  onClick={() => setIsOpen(false)}
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
                  onClick={() => setIsOpen(false)}
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
