"use client";

import { RailColumn } from "@/kit/RailFrame";
import { StatusPage } from "@/kit/StatusPage";

import { COPY } from "@/core/copy";
import { useReportClientCrash } from "@/shared/hooks/useReportClientCrash";

import { ACCOUNT_HOME } from "./entries";

/**
 * A failed Konto page in the rail frame: this boundary stands inside the frame's layout and replaces the route group's
 * column with the page, so it draws the phone's band itself. Its way on is the list of Konto's pages, which reads
 * nothing but the session.
 */
export default function AccountError({ error }: { error: unknown }) {
  useReportClientCrash(error);
  return (
    <RailColumn back={ACCOUNT_HOME.href}>
      <StatusPage
        frame="rail"
        scope="area"
        title={COPY.shared.failure.unexpected}
        card={{ tone: "danger", next: ACCOUNT_HOME }}
      />
    </RailColumn>
  );
}
