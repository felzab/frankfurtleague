import { KONTAKT_EMAIL } from "@/core/brand";
import { isRecordMissing } from "@/core/errors";
import { isFunktionLost, isRefusal } from "@/shared/utils/actionError";

import type { FieldErrors } from "@/shared/utils/validation";

/**
 * The league's last owner, whose erasure would leave the administration owned by nobody: the repair is
 * another owner first. One sentence for the page, the early refusal and the backend's
 * (`docs/frontend/spec.md :: I708`).
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

/** The new address folds to the one signed in: the box is the way out, so the sentence stands on it. */
const SCHON_ANGEMELDET = "Mit dieser Adresse bist Du schon angemeldet.";

/** The address holds no pupil row and no confirmed referee row, whose address alone the change moves. */
const KEIN_EINTRAG = `Unter Deiner Adresse steht kein Eintrag, dessen Adresse sich hier ändern lässt. Schreib uns an ${KONTAKT_EMAIL}.`;

/**
 * The person's own start, or `null`. Worded ahead of the person spine's reader, whose sentence for
 * `REQ-FUNKTION-001` names a seat this page has not got.
 */
export function mapKontoAdresswechselRefusal(error: unknown): { error?: string; fieldErrors?: FieldErrors } | null {
  if (isFunktionLost(error)) return { error: KEIN_EINTRAG };
  if (!isRefusal(error)) return null;

  switch (error.serverErrorCode) {
    // One sentence whichever lane carries the change: the person does not know which record does.
    case "REQ-SPIELER-007":
    case "REQ-SCHIEDSRICHTER-012":
      return { error: SCHON_ANGEMELDET, fieldErrors: { email: SCHON_ANGEMELDET } };
    default:
      return null;
  }
}

/** The approval, or `null`: a change answered, stopped or replaced since the page loaded is the 404. */
export function mapKontoFreigabeRefusal(error: unknown): string | null {
  if (isRecordMissing(error)) return "Es wartet keine Änderung mehr auf Deine Freigabe. Lade die Seite neu.";
  if (!isRefusal(error)) return null;

  switch (error.serverErrorCode) {
    case "REQ-SPIELER-002":
    case "REQ-SCHIEDSRICHTER-003":
      return "Die Zeit für die Freigabe ist abgelaufen. Die Änderung wird gelöscht.";
    default:
      return null;
  }
}

/** The stop, or `null`: the one refusal is a change already gone, whose page the reload brings up to date. */
export function mapKontoStoppRefusal(error: unknown): string | null {
  return isRecordMissing(error) ? "Es wartet keine Änderung mehr. Lade die Seite neu." : null;
}
