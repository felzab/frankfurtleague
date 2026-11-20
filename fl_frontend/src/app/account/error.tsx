"use client";

import { COPY } from "@/core/copy/shared";
import { RailColumn } from "@/kit/RailFrame";
import { StatusPage } from "@/kit/StatusPage";
import { useReportClientCrash } from "@/shared/hooks/useReportClientCrash";

import { ACCOUNT_HOME } from "./entries";

/**
 * A failed Konto page in the rail frame: this boundary stands inside the frame's layout and replaces the route group's
 * column with the page, so it draws the phone's band itself, leading back to the list of Konto's pages, which reads
 * nothing but the session.
 */
export default function AccountError({ error, retry }: { error: unknown; retry: () => void }) {
  useReportClientCrash(error);
  return (
    <RailColumn back={ACCOUNT_HOME.href}>
      <StatusPage
        scope="area"
        title={COPY.shared.failure.unexpected}
        card={{ tone: "danger", next: { label: COPY.shared.verb.retry, retry } }}
      />
    </RailColumn>
  );
}
