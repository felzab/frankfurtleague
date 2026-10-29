import { isRefusal } from "@/shared/utils/actionError";

/**
 * The league's last owner, whose erasure would leave the administration owned by nobody: the repair is
 * another owner first. One sentence for the page, the early refusal and the backend's.
 */
export const LETZTE_INHABERIN =
  "Du bist die letzte Person, der die Verwaltung gehört. Mache zuerst eine andere Person aus der Verwaltung zur Inhaberin oder zum Inhaber, dann kannst Du Dein Konto löschen.";

/**
 * `null` where the refusal is something else, which the shared reader answers. The backend refuses the last
 * owner after the library spent the link, two owners having pressed at once, which the action's answer adds.
 */
export function mapLoeschungRefusal(error: unknown): { error: string } | null {
  if (!isRefusal(error)) return null;

  return error.serverErrorCode === "REQ-PURGE-004" ? { error: LETZTE_INHABERIN } : null;
}
