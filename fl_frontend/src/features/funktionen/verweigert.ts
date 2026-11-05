import { logRefused } from "@/core/refused";

import type { Refusal } from "@/core/refused";

/** Why a page turned a signed-in person away: the session it was judged under stands, so never `no_session`. */
export type PageVerweigerung = Exclude<Refusal, "no_session">;

/** A page's own turn-away, by the route's pattern rather than the address it was opened at. */
export function logPageVerweigert(route: string, grund: PageVerweigerung): void {
  logRefused(route, grund);
}
