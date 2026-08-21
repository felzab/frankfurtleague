"use client";

import Link from "next/link";

import { CircleInfo, Persons } from "@gravity-ui/icons";

import { Badge, Popover, Separator } from "@heroui/react";

import { austrittKuerzel, austrittZustand } from "@/features/teams/constants";
import { overlayPanel } from "@/shared/components/ui/overlayPanel";
import { useNavigationClosedOverlay } from "@/shared/hooks/useNavigationClosedOverlay";

import type { FLAustrittType } from "@/features/teams/schemas";

/**
 * **Every team this mounts for is a real team** — a fixture side with no occupant renders its
 * provenance label as plain text and never reaches here, which is why neither link is conditional.
 */
export function TeamPopoverMenu({
  teamName,
  teamId,
  teamAustritt,
  placement = "right",
  onNavigate,
  children,
}: {
  teamName: string;
  teamId: string;
  /**
   * Required, not optional: a caller omitting it compiles clean and renders no badge, where `tsc`
   * should be catching the next caller that cannot supply it.
   */
  teamAustritt: FLAustrittType | null;
  /**
   * `"top"` where the trigger is wide and centred: react-aria flips only on the MAIN axis and never
   * clamps to the viewport, so a vertical placement moves width onto the clamped cross axis.
   */
  placement?: "right" | "top";
  /**
   * Fires only where a link really navigates, for a caller holding an overlay open around this one:
   * the App Router keeps a departed page in a hidden Activity tree, so a dialog nobody closed is
   * open again on return.
   */
  onNavigate?: () => void;
  children: React.ReactNode;
}) {
  const { isOpen, setIsOpen } = useNavigationClosedOverlay();

  // The router hides this popover's page, Effects and all, so `useNavigationClosedOverlay`'s effect
  // never reaches it. The hook stays anyway — that redundancy is the router's behaviour.
  const closeOnNavigate = () => {
    setIsOpen(false);
    onNavigate?.();
  };

  // Not a control: it only stops the card underneath from also reacting. `Popover.Trigger` below is
  // the control, so an interactive role here would invent a duplicate.
  return (
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
    <div
      className="contents"
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}>
      <Popover
        isOpen={isOpen}
        onOpenChange={setIsOpen}>
        {/* `min-w-0 max-w-full` on each layer is what lets a caller's `truncate` work: HeroUI's
            `.popover__trigger` keeps `min-width:auto` as a flex item, and `.badge-anchor` bakes in
            `shrink-0`, which `shrink` undoes. */}
        {/* The trigger IS the control — no <button> inside. `Popover.Trigger` renders a focusable
            `div role="button"` (react-aria `Pressable`), so nesting a real button gives every team
            name TWO tab stops. */}
        <Popover.Trigger className="hover:text-brand relative inline-flex max-w-full min-w-0 cursor-pointer items-center rounded text-left transition-colors duration-200">
          <Badge.Anchor className="max-w-full min-w-0 shrink">{children}</Badge.Anchor>
        </Popover.Trigger>

        <Popover.Content
          placement={placement}
          offset={10}>
          {/* `max-w` caps the panel: nothing else constrains it, so a long team name would push the
              dialog past the viewport edge. */}
          <Popover.Dialog className={`${overlayPanel()} w-max max-w-[280px] p-4 outline-none`}>
            <Popover.Arrow className="fill-surface" />

            <Popover.Heading className="fluid-base flex w-full flex-row items-center justify-between font-bold">
              <span className="truncate pr-2">{teamName}</span>
              {/* `-strong` on the tint, as `SaisontabelleView`'s badge does: at this size the
                  fill-grade accent measures 3.80:1 on this panel in light. */}
              {teamAustritt !== null && (
                <span
                  aria-label={austrittZustand(teamAustritt)}
                  className="bg-danger/10 text-danger-strong fluid-xxs rounded-md px-2 py-0.5 font-extrabold uppercase">
                  {austrittKuerzel(teamAustritt)}
                </span>
              )}
            </Popover.Heading>

            <Separator
              orientation="horizontal"
              className="bg-border my-3 h-[1px] w-full"
            />

            {/* `onNavigate`, not `onClick`: it fires only where the press really navigates, so a
                modifier-click opening a new tab leaves this panel and the caller's dialog standing. */}
            <div className="fluid-sm flex size-full flex-col gap-y-1">
              <Link
                prefetch={false}
                href={`/dashboard/teams/${teamId}`}
                onNavigate={closeOnNavigate}
                className="hover:bg-hover text-foreground-muted hover:text-foreground flex w-full flex-row items-center gap-x-2.5 rounded-lg px-2.5 py-2 font-semibold transition-colors">
                <CircleInfo
                  className="text-brand shrink-0"
                  width={18}
                  height={18}
                />
                <span>Team-Details</span>
              </Link>

              <Link
                prefetch={false}
                href={`/dashboard/spieler/${teamId}`}
                onNavigate={closeOnNavigate}
                className="hover:bg-hover text-foreground-muted hover:text-foreground flex w-full flex-row items-center gap-x-2.5 rounded-lg px-2.5 py-2 font-semibold transition-colors">
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
