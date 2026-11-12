"use client";

import { ClassicStatusPage } from "@/kit/StatusCard";

import { COPY } from "@/core/copy";
import { ROUTES } from "@/core/routes";
import { useReportClientCrash } from "@/shared/hooks/useReportClientCrash";

/**
 * A classic page that failed, inside the frame its layout drew: what happened, plainly, and the way to the start
 * page.
 */
export default function ClassicError({ error }: { error: unknown }) {
  useReportClientCrash(error);
  return (
    <ClassicStatusPage
      tone="danger"
      title={COPY.shared.failure.unexpected}
      next={{ label: COPY.shared.end.toHome, href: ROUTES.home.path() }}
    />
  );
}
