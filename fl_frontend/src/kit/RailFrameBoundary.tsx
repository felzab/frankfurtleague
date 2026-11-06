"use client";

import { catchError } from "next/error";

import { COPY } from "@/core/copy";
import { useReportClientCrash } from "@/shared/hooks/useReportClientCrash";

import { RailFrame } from "./RailFrame";
import { StatusPage } from "./StatusPage";

import type { Route } from "next";
import type { ErrorInfo } from "next/error";
import type { RailGroup } from "./FrameNav";
import type { RailPageHead } from "./RailFrame";
import type { StatusCardProps } from "./StatusPage";

/** One read for every render, which `use` would otherwise meet as a new promise each time and wait on afresh. */
const NOBODY = Promise.resolve(null);

/**
 * What a failed frame is drawn again with: its menu, its way back where the area has its own, and the card's way on,
 * which resolves the scope the person works in. `signIn` is a public frame's foot, where nobody is signed in.
 */
type FailedFrame = {
  groups: ReadonlyArray<RailGroup>;
  bar: Parameters<typeof RailFrame>[0]["bar"];
  next: StatusCardProps["next"];
  back?: Route;
  signIn?: Route;
};

/** The error card in the rail form, as an area's `error.tsx` draws it, its title in the strip, its one way on. */
function RailError({ error, next, scope }: { error: unknown; next: StatusCardProps["next"]; scope: RailPageHead["scope"] }) {
  useReportClientCrash(error);
  return (
    <StatusPage
      frame="rail"
      scope={scope}
      title={COPY.shared.failure.unexpected}
      card={{ tone: "danger", next }}
    />
  );
}

function FrameFailure({ groups, bar, next, back, signIn }: FailedFrame, { error }: ErrorInfo) {
  // Drawn again without the reads that failed: no season and no account, so nothing in it can fail the same way.
  return (
    <RailFrame
      groups={groups}
      bar={bar}
      back={back}
      foot={signIn === undefined ? { kind: "account", account: NOBODY } : { kind: "signIn", href: signIn }}>
      <RailError
        error={error}
        next={next}
        scope={signIn === undefined ? "area" : "saison"}
      />
    </RailFrame>
  );
}

/**
 * Around a rail frame, for a failure of the frame's own reads, the seasons and the account, which its layout hands
 * down unawaited: the area's `error.tsx` stands inside that layout and catches none of it, and the root's draws no
 * frame. The failure is answered inside the rail frame drawn again with its menu alone.
 */
export const RailFrameBoundary = catchError(FrameFailure);
