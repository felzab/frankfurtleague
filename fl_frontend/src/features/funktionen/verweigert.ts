import { logRefused } from "@/core/verweigert";

import type { Refusal } from "@/core/verweigert";

/** Why a page turned a signed-in person away: the session it was judged under stands, so never `keine_sitzung`. */
export type PageVerweigerung = Exclude<Refusal, "keine_sitzung">;

/** A page's own turn-away, by the route's pattern rather than the address it was opened at. */
export function logPageVerweigert(route: string, grund: PageVerweigerung): void {
  logRefused(route, grund);
}
