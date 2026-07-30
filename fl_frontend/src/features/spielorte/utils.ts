// Relative, not "@/shared/utils/format": this module is covered by utils.test.ts, and Node's ESM
// resolver does not read tsconfig paths, so a "@/" value import anywhere in a tested module's graph
// fails with ERR_MODULE_NOT_FOUND under `node --test`. Type-only "@/" imports are fine -- they are
// stripped before resolution -- which is why the Wave 1 test targets never hit this.
import { buildMapsSearchUrl, formatAddressFull } from "../../shared/utils/format.ts";

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
