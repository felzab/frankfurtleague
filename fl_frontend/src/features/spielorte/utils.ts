import { buildMapsSearchUrl, formatAddressFull } from "@/shared/utils/format";

import type { FLSpielort } from "./schemas";

/**
 * Searched by name plus full address, so the pin resolves to the venue rather than to the street.
 * Not in `shared`, which may not import a `features` type.
 */
export function formatMapsLink(ort: FLSpielort): string {
  return buildMapsSearchUrl(`${ort.name}, ${formatAddressFull(ort.address)}`);
}
