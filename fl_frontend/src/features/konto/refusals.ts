import { isRefusal } from "@/shared/utils/actionError";

/**
 * The league's last owner, whose erasure would leave the administration with nobody owning it: the repair
 * is another owner first, on the administrators' page. The link was spent before the backend refused.
 */
const LETZTE_INHABERIN =
  "Du bist die letzte Person, der die Verwaltung gehört. Mache zuerst eine andere Person aus der Verwaltung zur Inhaberin oder zum Inhaber, dann kannst Du Dein Konto löschen.";

/** `null` where the refusal is something else, which the shared reader answers. */
export function mapLoeschungRefusal(error: unknown): { error: string } | null {
  if (!isRefusal(error)) return null;

  return error.serverErrorCode === "REQ-PURGE-004" ? { error: LETZTE_INHABERIN } : null;
}
