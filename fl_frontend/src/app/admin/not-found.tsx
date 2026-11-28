import { COPY } from "@/core/copy/shared";
import { ROUTES } from "@/core/routes";
import { SERVER_COPY } from "@/core/serverCopy";
import { StatusPage } from "@/kit/StatusPage";

import type { WayOn } from "@/kit/StatusCard";

/** Where the card leads on: the area's root, which leads to the Übersicht of the season the site is on. */
const ADMIN_HOME = { label: COPY.shared.end.toOverview, href: ROUTES.admin.path() } as const satisfies WayOn;

/**
 * A record the administration does not hold, in the rail frame: this boundary stands inside the frame's layout, so the
 * frame's band and bar stand around it.
 */
export default function AdminNotFound() {
  return (
    <StatusPage
      scope="area"
      title={SERVER_COPY.notFound}
      card={{ tone: "info", next: ADMIN_HOME }}
    />
  );
}
