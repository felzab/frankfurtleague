import { logger } from "@/core/logging";

/** Why a page turned a signed-in person away: no seat at a team's address, or not the Funktion the page speaks to. */
export type PageVerweigerung = "kein_sitz" | "keine_funktion";

/**
 * A page's own turn-away, in the person write spine's event and shape
 * (`fl_frontend/src/shared/utils/personMutation.ts :: runPersonMutation`): the route's pattern and the
 * reason, never an address or an id. A refusal the backend answers is its own to log.
 */
export function logPageVerweigert(route: string, grund: PageVerweigerung): void {
  logger.info("funktion.verweigert", { operation: route, grund: grund });
}
