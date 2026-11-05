import { RailColumn } from "@/kit/RailFrame";
import { StatusPage } from "@/kit/StatusPage";

import { COPY } from "@/core/copy";
import { ROUTES } from "@/core/routes";
import { SERVER_COPY } from "@/core/serverCopy";

/**
 * A record or an address the administration does not hold, in the rail frame: this boundary stands inside the
 * frame's layout and replaces the route group's column with the page, so it draws the phone's band and bar itself.
 */
export default function AdminNotFound() {
  return (
    <RailColumn>
      <StatusPage
        frame="rail"
        scope="area"
        title={SERVER_COPY.landing.notFound}
        card={{ tone: "info", next: { label: COPY.shared.end.toOverview, href: ROUTES.admin.path() } }}
      />
    </RailColumn>
  );
}
