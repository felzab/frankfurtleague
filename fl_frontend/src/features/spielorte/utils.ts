import { formatAddressFull } from "@/shared/utils/format";

import type { FLSpielort } from "@/core/generated/client/types";

/**
 * The search string the backend stores as `maps_link` (`fl_backend/app/api/spielorte/admin_router.py :: _maps_link`):
 * the name first, so the pin resolves to the venue rather than to the street.
 */
export function mapsQuery(ort: Pick<FLSpielort, "name" | "address">): string {
  return `${ort.name}, ${formatAddressFull(ort.address)}`;
}
