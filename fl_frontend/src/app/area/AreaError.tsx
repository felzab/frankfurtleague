"use client";

import { StatusPage } from "@/kit/StatusPage";

import { COPY } from "@/core/copy";
import { useReportClientCrash } from "@/shared/hooks/useReportClientCrash";

import { AREA_HOME } from "./areaHome";

/**
 * A failed page of a team's or a person's area, in the rail frame its layout drew: one card for the four frames, so
 * each frame's `error.tsx` adds only the phone's band and bar where its layouts place them.
 */
export function AreaError({ error }: { error: unknown }) {
  useReportClientCrash(error);
  return (
    <StatusPage
      scope="area"
      title={COPY.shared.failure.unexpected}
      card={{ tone: "danger", next: AREA_HOME }}
    />
  );
}
