"use client";

import { COPY } from "@/core/copy/shared";
import { StatusPage } from "@/kit/StatusPage";
import { useReportClientCrash } from "@/shared/hooks/useReportClientCrash";

/** A public season page that failed, in the rail frame its layout drew: what happened, plainly, and a retry in place. */
export default function SaisonsError({ error, retry }: { error: unknown; retry: () => void }) {
  useReportClientCrash(error);
  return (
    <StatusPage
      scope="saison"
      title={COPY.shared.failure.unexpected}
      card={{ tone: "danger", next: { label: COPY.shared.verb.retry, retry } }}
    />
  );
}
