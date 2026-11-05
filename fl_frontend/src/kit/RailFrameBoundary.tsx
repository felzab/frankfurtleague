"use client";

import { catchError } from "next/error";

import { COPY } from "@/core/copy";
import { useReportClientCrash } from "@/shared/hooks/useReportClientCrash";

import { RailFrame } from "./RailFrame";
import { StatusPage } from "./StatusPage";

import type { Route } from "next";
import type { ErrorInfo } from "next/error";
import type { RailGroup } from "./FrameNav";

/** One read for every render, which `use` would otherwise meet as a new promise each time and wait on afresh. */
const NOBODY = Promise.resolve(null);

/** What a failed frame is drawn again with: its menu, and where its way on leads. */
type FailedFrame = { groups: ReadonlyArray<RailGroup>; bar: Parameters<typeof RailFrame>[0]["bar"]; home: Route };

/**
 * The error card in the rail form, as an area's `error.tsx` draws it, its title in the strip, its one way on the
 * frame's root, which resolves the scope the person works in: a signed-in frame's Übersicht.
 */
function RailError({ error, home }: { error: unknown; home: Route }) {
  useReportClientCrash(error);
  return (
    <StatusPage
      frame="rail"
      scope="area"
      title={COPY.shared.failure.unexpected}
      card={{ tone: "danger", next: { label: COPY.shared.end.toOverview, href: home } }}
    />
  );
}

function FrameFailure({ groups, bar, home }: FailedFrame, { error }: ErrorInfo) {
  // Drawn again without the reads that failed: no season and no account, so nothing in it can fail the same way.
  return (
    <RailFrame
      groups={groups}
      bar={bar}
      foot={{ kind: "account", account: NOBODY }}>
      <RailError
        error={error}
        home={home}
      />
    </RailFrame>
  );
}

/**
 * Around a signed-in area's rail frame, for a failure of the frame's own reads, the seasons and the account, which
 * its layout hands down unawaited: the area's `error.tsx` stands inside that layout and catches none of it, and the
 * root's would draw the classic frame. The failure is answered inside the rail frame drawn again with its menu alone.
 */
export const RailFrameBoundary = catchError(FrameFailure);
