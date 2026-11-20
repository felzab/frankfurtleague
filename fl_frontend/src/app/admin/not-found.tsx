import { SERVER_COPY } from "@/core/serverCopy";
import { RailColumn } from "@/kit/RailFrame";
import { StatusPage } from "@/kit/StatusPage";

import { ADMIN_HOME } from "./adminHome";

/**
 * A record the administration does not hold, in the rail frame: this boundary stands inside the frame's layout and
 * replaces the route group's column with the page, so it draws the phone's band and bar itself.
 */
export default function AdminNotFound() {
  return (
    <RailColumn>
      <StatusPage
        scope="area"
        title={SERVER_COPY.notFound}
        card={{ tone: "info", next: ADMIN_HOME }}
      />
    </RailColumn>
  );
}
