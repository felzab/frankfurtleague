"use client";

import { usePathname } from "next/navigation";

import { COPY } from "@/core/copy/shared";
import { TO_HOME } from "@/kit/mailedLinkState";
import { ClassicStatusPage } from "@/kit/StatusCard";
import { useReportClientCrash } from "@/shared/hooks/useReportClientCrash";

/**
 * The root boundary, above every layout but the root one: what failed here can be a frame itself, so it draws none,
 * only the status card on the page's ground, retrying in place, with the way to the start page beneath it, since no
 * frame is left to lead anywhere when the retry fails again. On the start page itself the way is left out: Next clears
 * a boundary only when the pathname changes, so a link to the same page would do nothing.
 */
export default function ErrorBoundary({ error, retry }: { error: unknown; retry: () => void }) {
  useReportClientCrash(error);
  const atHome = usePathname() === TO_HOME.href;
  return (
    <ClassicStatusPage
      tone="danger"
      title={COPY.shared.failure.unexpected}
      next={{ retry }}
      quiet={atHome ? undefined : TO_HOME}
    />
  );
}
