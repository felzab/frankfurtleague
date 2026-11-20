"use client";

import { usePathname } from "next/navigation";

import { COPY } from "@/core/copy/shared";
import { TO_HOME } from "@/kit/mailedLinkState";
import { ClassicStatusPage } from "@/kit/StatusCard";
import { useReportClientCrash } from "@/shared/hooks/useReportClientCrash";

/**
 * A classic page that failed, inside the frame its layout drew: what happened, plainly, and the way to the start
 * page, a whole page load where the card stands on the start page itself, which a client navigation would not clear.
 */
export default function ClassicError({ error }: { error: unknown }) {
  useReportClientCrash(error);
  const atHome = usePathname() === TO_HOME.href;
  return (
    <ClassicStatusPage
      tone="danger"
      title={COPY.shared.failure.unexpected}
      next={{ ...TO_HOME, fullPage: atHome }}
    />
  );
}
