import { RailFrame } from "./RailFrame";
import { RailFrameBoundary } from "./RailFrameBoundary";

import type { Route } from "next";
import type { ComponentProps } from "react";
import type { StatusCardProps } from "./StatusCard";

/**
 * A rail frame inside the boundary answering a failure of its own reads, handed the menu once, so the error card
 * stands in the menu of the page it replaces. The boundary stands above the frame, since the reads it catches are
 * the frame's: an area's `error.tsx` stands inside the layout placing this, and catches none of them.
 *
 * `next` is the card's way on. An area's own way back is a read, as Konto's is, so it comes with the address the
 * failed frame is drawn with instead (`failed`): the read may be what failed.
 */
export function GuardedRailFrame({
  next,
  back,
  ...frame
}: Omit<ComponentProps<typeof RailFrame>, "back"> & {
  next: StatusCardProps["next"];
  back?: { read: Promise<Route | null>; failed: Route };
}) {
  return (
    <RailFrameBoundary
      groups={frame.groups}
      bar={frame.bar}
      next={next}
      back={back?.failed}
      signIn={frame.foot.kind === "signIn" ? frame.foot.href : undefined}>
      <RailFrame
        {...frame}
        back={back?.read}
      />
    </RailFrameBoundary>
  );
}
