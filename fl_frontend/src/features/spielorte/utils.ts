/**
 * SPIELORTE · derivations
 *
 * Pure formatting over a venue. Lives here rather than in `shared/utils/format.ts` because it takes an
 * `FLSpielort`: hosting it in `shared` would force a `shared -> features` type import and stop
 * `src/shared` from standing on its own, which the lint rules enforce.
 */

import { buildMapsSearchUrl, formatAddressFull } from "@/shared/utils/format";

import type { FLSpielort } from "./schemas";

/**
 * A Spielort's Google Maps link, searched by name plus full address so the pin resolves to the
 * venue rather than to the street.
 *
 * Lives here, not in `shared/utils/format.ts`: it takes an `FLSpielort`, so hosting it in `shared`
 * forced a `shared -> features` type import and stopped `src/shared` from standing alone (R2 2.2).
 */
export function formatMapsLink(ort: FLSpielort): string {
  return buildMapsSearchUrl(`${ort.name}, ${formatAddressFull(ort.address)}`);
}
