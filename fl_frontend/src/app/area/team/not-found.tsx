import { AreaNotFound } from "../AreaNotFound";

/**
 * Where a team page's read ends without a page, in the rail frame: a record the team does not hold. A person holding
 * no seat at the address is sent on to the landing before any read. This boundary stands inside the frame's layout,
 * so the frame's band and bar stand around it.
 */
export default function TeamNotFound() {
  return <AreaNotFound />;
}
