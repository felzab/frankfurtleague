import { logger } from "./logging";

/** Why a person was turned away: no session, no seat at the address, or not the Funktion a page speaks to. */
export type Refusal = "keine_sitzung" | "kein_sitz" | "keine_funktion";

/**
 * A person's turn-away, by a page or a write, in one event and shape, so one query reads both lanes:
 * the operation and the reason, never an address or an id. A backend refusal is the backend's to log.
 */
export function logRefused(operation: string, grund: Refusal): void {
  logger.info("roles.refused", { operation: operation, grund: grund });
}
