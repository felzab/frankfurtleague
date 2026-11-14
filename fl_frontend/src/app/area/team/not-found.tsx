import { RailColumn } from "@/kit/RailFrame";
import { StatusPage } from "@/kit/StatusPage";

import { SERVER_COPY } from "@/core/serverCopy";

import { AREA_HOME } from "../areaHome";
import { AreaNotFound } from "../AreaNotFound";
import { TeamEnd } from "./TeamEnd";

/**
 * Where a team page's read ends without a page, in the rail frame: a record the team does not hold, or a team the
 * person holds no seat on, whose card names nothing of the address and leads to the person's own Übersicht. This
 * boundary stands inside the frame's layout and replaces the route group's column with the page, so it draws the
 * phone's band and bar itself.
 */
export default function TeamNotFound() {
  return (
    <RailColumn>
      <TeamEnd
        missing={<AreaNotFound />}
        refused={
          <StatusPage
            scope="area"
            title={SERVER_COPY.area.forbidden}
            card={{ tone: "warn", next: AREA_HOME }}
          />
        }
      />
    </RailColumn>
  );
}
