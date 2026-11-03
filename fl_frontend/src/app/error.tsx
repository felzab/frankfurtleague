"use client";

import { StatusPage } from "@/kit/StatusPage";

import { COPY } from "@/core/copy";
import { ROUTES } from "@/core/routes";
import { useReportClientCrash } from "@/shared/hooks/useReportClientCrash";

/**
 * The root boundary, above every layout: what failed here can be a frame itself, so it draws none, only the
 * status card on the page's ground with the way to the start page (D284, D481 error).
 */
export default function ErrorBoundary({ error }: { error: unknown }) {
  useReportClientCrash(error);
  return (
    <StatusPage
      frame="classic"
      mark="error"
      title={COPY.shared.failure.unexpected}
      next={{ label: COPY.shared.end.toHome, href: ROUTES.home.path() }}
    />
  );
}
