"use client";

import { COPY } from "@/core/copy/shared";
import { TO_HOME } from "@/kit/mailedLinkState";
import { StatusPage } from "@/kit/StatusPage";
import { useReportClientCrash } from "@/shared/hooks/useReportClientCrash";

/** A public season page that failed, in the rail frame its layout drew: what happened, plainly, and the way to the start page. */
export default function SaisonsError({ error }: { error: unknown }) {
  useReportClientCrash(error);
  return (
    <StatusPage
      scope="saison"
      title={COPY.shared.failure.unexpected}
      card={{ tone: "danger", next: TO_HOME }}
    />
  );
}
