"use client";

import { COPY } from "@/core/copy/shared";
import { StatusPage } from "@/kit/StatusPage";
import { useReportClientCrash } from "@/shared/hooks/useReportClientCrash";

/**
 * A failed page of a team's or a person's area, in the rail frame its layout drew: one card for the four frames, so
 * each frame's `error.tsx` adds only the phone's band and bar where its layouts place them, and hands on the `retry`
 * Next gave it.
 */
export function AreaError({ error, retry }: { error: unknown; retry: () => void }) {
  useReportClientCrash(error);
  return (
    <StatusPage
      scope="area"
      title={COPY.shared.failure.unexpected}
      card={{ tone: "danger", next: { label: COPY.shared.verb.retry, retry } }}
    />
  );
}
