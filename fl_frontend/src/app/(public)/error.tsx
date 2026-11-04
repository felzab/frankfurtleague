"use client";

// Redesign: goes with the (public) group's last page.
import { StatusCard } from "@/kit/StatusPage";

import { COPY } from "@/core/copy";
import { ROUTES } from "@/core/routes";
import { useReportClientCrash } from "@/shared/hooks/useReportClientCrash";

/*
  Below `fl_frontend/src/app/(public)/layout.tsx` rather than at the root, so Next renders it inside
  `PublicShell`: a visitor whose page failed keeps the navigation and the footer. The card alone, since the
  shell already writes the page's `main`.
*/
export default function PublicErrorBoundary({ error }: { error: unknown }) {
  useReportClientCrash(error);
  return (
    <StatusCard
      tone="danger"
      title={COPY.shared.failure.unexpected}
      next={{ label: COPY.shared.end.toHome, href: ROUTES.home.path() }}
    />
  );
}
