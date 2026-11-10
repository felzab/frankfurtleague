import { RailColumn } from "@/kit/RailFrame";

import { AreaNotFound } from "../../AreaNotFound";

/**
 * A season or a match a referee's pages do not hold, in the rail frame: this boundary stands inside the frame's layout
 * and replaces the route group's column with the page, so it draws the phone's band and bar itself.
 */
export default function SchiedsrichterNotFound() {
  return (
    <RailColumn>
      <AreaNotFound />
    </RailColumn>
  );
}
