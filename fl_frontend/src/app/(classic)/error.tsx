"use client";

import { StatusPage } from "@/kit/StatusPage";

import { COPY } from "@/core/copy";
import { ROUTES } from "@/core/routes";
import { useReportClientCrash } from "@/shared/hooks/useReportClientCrash";

/**
 * A classic page that failed, inside the frame its layout drew: what happened, plainly, and the way to the start
 * page (D284, D481 error).
 */
export default function ClassicError({ error }: { error: unknown }) {
  useReportClientCrash(error);
  return (
    <StatusPage
      frame="classic"
      tone="danger"
      title={COPY.shared.failure.unexpected}
      next={{ label: COPY.shared.end.toHome, href: ROUTES.home.path() }}
    />
  );
}
