"use client";

import { COPY } from "@/core/copy/shared";
import { RailColumn } from "@/kit/RailFrame";
import { StatusPage } from "@/kit/StatusPage";
import { useReportClientCrash } from "@/shared/hooks/useReportClientCrash";

import { ADMIN_HOME } from "./adminHome";

/**
 * A failed page of the administration, an unread grant among its failures, in the rail frame: this boundary stands
 * inside the frame's layout and replaces the route group's column with the page, so it draws the phone's band
 * and bar itself.
 */
export default function AdminError({ error }: { error: unknown }) {
  useReportClientCrash(error);
  return (
    <RailColumn>
      <StatusPage
        scope="area"
        title={COPY.shared.failure.unexpected}
        card={{ tone: "danger", next: ADMIN_HOME }}
      />
    </RailColumn>
  );
}
