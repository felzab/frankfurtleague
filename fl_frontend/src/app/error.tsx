"use client";

import { usePathname } from "next/navigation";

import { COPY } from "@/core/copy/shared";
import { ROUTES } from "@/core/routes";
import { ClassicStatusPage } from "@/kit/StatusCard";
import { useReportClientCrash } from "@/shared/hooks/useReportClientCrash";

/**
 * The root boundary, above every layout but the root one: what failed here can be a frame itself, so it draws none,
 * only the status card on the page's ground with the way to the start page, a whole page load where the card stands
 * on the start page itself, which a client navigation would not clear.
 */
export default function ErrorBoundary({ error }: { error: unknown }) {
  useReportClientCrash(error);
  const home = ROUTES.home.path();
  const atHome = usePathname() === home;
  return (
    <ClassicStatusPage
      tone="danger"
      title={COPY.shared.failure.unexpected}
      next={{ label: COPY.shared.end.toHome, href: home, fullPage: atHome }}
    />
  );
}
