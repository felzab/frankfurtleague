import { isRefusal } from "@/shared/utils/actionError";

/**
 * `null` for any code but the unique index's, which on the junction's natural key says the club already
 * stands in the season.
 */
export function mapAlreadyEnteredRefusal(error: unknown): string | null {
  if (!isRefusal(error) || error.serverErrorCode !== "duplicate_key") return null;

  return "Dieses Team ist schon in dieser Saison. Lade die Seite neu.";
}
