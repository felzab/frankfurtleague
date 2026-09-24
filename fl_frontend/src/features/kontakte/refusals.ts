import { APIBadStatusError } from "@/core/errors";
import { buildRefusal } from "@/shared/utils/refusal";

/**
 * The stale-block refusal, or `null` when the 409 is something else. It lands on no field: the whole
 * screen is behind the row, so no box the admin could correct is at fault.
 */
export function mapStaleBlockRefusal(error: unknown): string | null {
  if (!(error instanceof APIBadStatusError) || error.statusCode !== 409 || error.serverErrorCode !== "REQ-KONTAKT-001") return null;

  return buildRefusal({
    reason: "Die Kontakte dieser Saison wurden inzwischen geändert, meistens durch das Löschen einer Kontaktperson",
    repair: "Lade die Seite neu und trage Deine Änderung dort erneut ein",
  });
}
