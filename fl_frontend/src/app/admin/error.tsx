"use client";

import { RailColumn } from "@/kit/RailFrame";
import { StatusPage } from "@/kit/StatusPage";

import { COPY } from "@/core/copy";
import { ROUTES } from "@/core/routes";
import { useReportClientCrash } from "@/shared/hooks/useReportClientCrash";

/**
 * A failed page of the administration, or a failed hold of its session, in the rail frame: this boundary stands
 * inside the frame's layout and replaces the route group's column with the page, so it draws the phone's band
 * and bar itself. Its way on is the area's root, which leads to the Übersicht of the season the site is on.
 */
export default function AdminError({ error }: { error: unknown }) {
  useReportClientCrash(error);
  return (
    <RailColumn>
      <StatusPage
        frame="rail"
        scope="area"
        title={COPY.shared.failure.unexpected}
        card={{ tone: "danger", next: { label: COPY.shared.end.toOverview, href: ROUTES.admin.path() } }}
      />
    </RailColumn>
  );
}
