import { isRefusal } from "@/shared/utils/actionError";

/**
 * The league's last owner, whose erasure would leave the administration owned by nobody: the repair is
 * another owner first. One sentence for the page, the early refusal and the backend's
 * (`docs/frontend/spec.md :: I708`).
 */
export const LETZTE_INHABERIN =
  "Du bist die letzte Person, der die Verwaltung gehört. Mache zuerst eine andere Person aus der Verwaltung zur Inhaberin oder zum Inhaber, dann kannst Du Dein Konto löschen.";

/** The backend refuses after the library spent the link, when two owners pressed at once. */
const LINK_VERBRAUCHT = "Dieser Link ist dabei verbraucht worden. Fordere danach auf Deiner Kontoseite einen neuen an.";

/** `null` where the refusal is something else, which the shared reader answers. */
export function mapLoeschungRefusal(error: unknown): { error: string } | null {
  if (!isRefusal(error)) return null;

  return error.serverErrorCode === "REQ-PURGE-004" ? { error: `${LETZTE_INHABERIN} ${LINK_VERBRAUCHT}` } : null;
}
