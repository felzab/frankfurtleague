import { RailColumn } from "@/kit/RailFrame";

import { AreaNotFound } from "../AreaNotFound";

/**
 * Where a team page's read ends without a page, in the rail frame: a record the team does not hold. A person holding
 * no seat at the address is sent on to the landing before any read. This boundary stands inside the frame's layout and
 * replaces the route group's column with the page, so it draws the phone's band and bar itself.
 */
export default function TeamNotFound() {
  return (
    <RailColumn>
      <AreaNotFound />
    </RailColumn>
  );
}
