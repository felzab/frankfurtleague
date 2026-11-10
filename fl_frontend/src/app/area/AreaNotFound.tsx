import { StatusPage } from "@/kit/StatusPage";

import { SERVER_COPY } from "@/core/serverCopy";

import { AREA_HOME } from "./areaHome";

/** A record or a season a team's or a person's area does not hold, in the rail frame its layout drew. */
export function AreaNotFound() {
  return (
    <StatusPage
      frame="rail"
      scope="area"
      title={SERVER_COPY.notFound}
      card={{ tone: "info", next: AREA_HOME }}
    />
  );
}
