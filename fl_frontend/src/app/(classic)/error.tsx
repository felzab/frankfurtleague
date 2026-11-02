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
  const words = COPY.landing.status.error;
  return (
    <StatusPage
      frame="classic"
      mark="error"
      title={words.title}
      sentence={words.sentence}
      next={{ label: COPY.shared.end.toHome, href: ROUTES.home.path() }}
    />
  );
}
