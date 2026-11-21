"use client";

import { COPY } from "@/core/copy/shared";
import { ClassicStatusPage } from "@/kit/StatusCard";
import { useReportClientCrash } from "@/shared/hooks/useReportClientCrash";

/** A classic page that failed, inside the frame its layout drew: what happened, plainly, and a retry in place. */
export default function ClassicError({ error, retry }: { error: unknown; retry: () => void }) {
  useReportClientCrash(error);
  return (
    <ClassicStatusPage
      tone="danger"
      title={COPY.shared.failure.unexpected}
      next={{ retry }}
    />
  );
}
