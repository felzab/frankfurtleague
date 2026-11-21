"use client";

import { COPY } from "@/core/copy/shared";
import { ROUTES } from "@/core/routes";
import { RailColumn } from "@/kit/RailFrame";
import { StatusPage } from "@/kit/StatusPage";
import { useReportClientCrash } from "@/shared/hooks/useReportClientCrash";

/**
 * A failed Konto page in the rail frame: this boundary stands inside the frame's layout and replaces the route group's
 * column with the page, so it draws the phone's band itself, leading back to the list of Konto's pages, which reads
 * nothing but the session.
 */
export default function AccountError({ error, retry }: { error: unknown; retry: () => void }) {
  useReportClientCrash(error);
  return (
    <RailColumn back={ROUTES.account.path()}>
      <StatusPage
        scope="area"
        title={COPY.shared.failure.unexpected}
        card={{ tone: "danger", next: { label: COPY.shared.verb.retry, retry } }}
      />
    </RailColumn>
  );
}
