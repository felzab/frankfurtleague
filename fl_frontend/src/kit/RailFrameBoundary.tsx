"use client";

import { catchError } from "next/error";

import { COPY } from "@/core/copy/shared";
import { useReportClientCrash } from "@/shared/hooks/useReportClientCrash";

import { RailFrame } from "./RailFrame";
import { StatusPage } from "./StatusPage";

import type { Route } from "next";
import type { ErrorInfo } from "next/error";
import type { RailGroup } from "./FrameNav";
import type { RailPageHead } from "./RailFrame";

/** One read for every render, which `use` would otherwise meet as a new promise each time and wait on afresh. */
const NOBODY = Promise.resolve(null);

/**
 * What a failed frame is drawn again with: its menu and its way back where the area has its own. `signIn` is a public
 * frame's foot, where nobody is signed in.
 */
type FailedFrame = {
  groups: ReadonlyArray<RailGroup>;
  bar: Parameters<typeof RailFrame>[0]["bar"];
  back?: Route;
  signIn?: Route;
};

/**
 * The error card in the rail form, its title in the strip, its retry: the one card of every rail frame's failure, this
 * boundary's and each area's `error.tsx`, inside the frame's band and bar.
 */
export function RailError({ error, retry, scope }: { error: unknown; retry: () => void; scope: RailPageHead["scope"] }) {
  useReportClientCrash(error);
  return (
    <StatusPage
      scope={scope}
      title={COPY.shared.failure.unexpected}
      card={{ tone: "danger", next: { retry } }}
    />
  );
}

function FrameFailure({ groups, bar, back, signIn }: FailedFrame, { error, retry }: ErrorInfo) {
  // Drawn again without the reads that failed: no season and no account, so nothing in it can fail the same way.
  return (
    <RailFrame
      groups={groups}
      bar={bar}
      back={back}
      foot={signIn === undefined ? { kind: "account", account: NOBODY } : { kind: "signIn", href: signIn }}>
      <RailError
        error={error}
        retry={retry}
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
