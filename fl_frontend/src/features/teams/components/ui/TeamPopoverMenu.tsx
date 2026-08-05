"use client";

import Link from "next/link";

import { CircleInfo, Persons } from "@gravity-ui/icons";

import { Badge, Popover, Separator } from "@heroui/react";

import { overlayPanel } from "@/shared/components/ui/overlayPanel";
import { useNavigationClosedOverlay } from "@/shared/hooks/useNavigationClosedOverlay";

/**
 * The shortcuts hanging off a team's name.
 *
 * **Every team this mounts for is a real team.** A fixture side with no occupant yet renders its
 * provenance label as plain text and never reaches here, because there is no team page and no squad
 * to link to (ADR-0041) — which is why neither link is conditional.
 */
export function TeamPopoverMenu({
  teamName,
  teamId,
  teamIsDisqualified,
  placement = "right",
  children,
}: {
  teamName: string;
  teamId: string;
  teamIsDisqualified?: boolean;
  /**
   * Defaults to `"right"`, which suits the cards: their triggers are truncated inside narrow grid
   * tracks, so one side always has room. Pass `"top"` where the trigger is wide and centred — with
   * a horizontal placement the width is the *main* axis, and react-aria only flips on that axis,
   * it never clamps to the viewport (`containerPadding` applies to the cross axis only). A vertical
   * placement moves width onto the cross axis, where it does get clamped.
   */
  placement?: "right" | "top";
  children: React.ReactNode;
}) {
  const { isOpen, setIsOpen } = useNavigationClosedOverlay();

  return (
    // Not a control: it stops the card underneath from also reacting when the trigger is pressed.
    // There is no action here to give a keyboard equivalent to — `Popover.Trigger` below is the
    // control — and giving this an interactive role would invent a second, duplicate one.
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
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
        {/* The trigger IS the control — no <button> inside it. `Popover.Trigger` renders a
            `div role="button"` wrapped in react-aria's `Pressable` (HeroUI 3.2.2, `popover.js`),
            which is focusable in its own right, so nesting a real button gave every team name TWO
            tab stops with two differently-shaped focus outlines. Keyboard activation is Pressable's.

            That also retires the old `type="button"` note: a div cannot submit a form, so the hazard
            of mounting this inside `AdminEditSpielDataForm` cannot arise by construction. */}
        <Popover.Trigger className="hover:text-brand relative inline-flex max-w-full min-w-0 cursor-pointer items-center rounded text-left transition-colors duration-200">
          <Badge.Anchor className="max-w-full min-w-0 shrink">{children}</Badge.Anchor>
        </Popover.Trigger>

        <Popover.Content
          placement={placement}
          offset={10}>
          {/* max-w caps the panel: nothing else constrains it, so without this the dialog grows to
              the full team name and a long one pushes it past the viewport edge. */}
          <Popover.Dialog className={`${overlayPanel()} w-max max-w-[280px] p-4 outline-none`}>
            <Popover.Arrow className="fill-surface" />

            <Popover.Heading className="fluid-base flex w-full flex-row items-center justify-between font-bold">
              <span className="truncate pr-2">{teamName}</span>
              {/* `-strong` on the tint, matching the DQ badge in SaisontabelleView: at 11.8px the
                  fill-grade accent measures 3.80:1 on this panel in the light theme. */}
              {teamIsDisqualified && (
                <span className="bg-danger/10 text-danger-strong fluid-xxs rounded-md px-2 py-0.5 font-extrabold uppercase">DQ</span>
              )}
            </Popover.Heading>

            <Separator
              orientation="horizontal"
              className="bg-border my-3 h-[1px] w-full"
            />

            {/* Links */}
            <div className="fluid-sm flex size-full flex-col gap-y-1">
              {/* TEAM-DETAILS */}
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

              {/* KADER */}
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
            </div>
          </Popover.Dialog>
        </Popover.Content>
      </Popover>
    </div>
  );
}
