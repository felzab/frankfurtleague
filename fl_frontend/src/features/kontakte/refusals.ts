import { BEWERBUNG_VERALTET } from "@/features/bewerbungen/utils";
import { SPERRLISTE_ADRESSE_GESPERRT } from "@/features/sperrliste/constants";
import { isRefusal } from "@/shared/utils/actionError";
import { buildRefusal } from "@/shared/utils/refusal";

/**
 * The re-send's refusal, or `null` when the refusal is something else. The editor offers the press
 * only on a filled, unconfirmed seat, so each code here is that seat moving after the page was read.
 */
export function mapEinladenRefusal(error: unknown): string | null {
  if (!isRefusal(error)) return null;

  switch (error.serverErrorCode) {
    case "REQ-KONTAKT-002":
      return buildRefusal({
        reason: "Dieser Sitz ist inzwischen leer oder schon bestätigt",
        repair: "Lade die Seite neu, um den aktuellen Stand zu sehen",
      });
    case "REQ-KONTAKT-003":
      return SPERRLISTE_ADRESSE_GESPERRT;
    // A link would ask to confirm a seat for a season that is over, or on a team that has left it.
    case "REQ-KONTAKT-005":
      return buildRefusal({
        reason: "Diese Saison ist vorbei oder das Team ist ausgetreten",
        repair: "Für diesen Eintrag verschicken wir keinen Bestätigungslink mehr",
      });
    default:
      return null;
  }
}

/**
 * The stale-block refusal, or `null` when the refusal is something else. It lands on no field: the whole
 * screen is behind the row, so no box the admin could correct is at fault.
 */
export function mapStaleBlockRefusal(error: unknown): string | null {
  if (!isRefusal(error)) return null;
  // The backend's judgement of a seat's label (`docs/backend/spec.md :: I866`): an editor opened
  // before a deploy moved the form's label sends it for a person the row did not hold.
  if (error.serverErrorCode === "REQ-EINWILLIGUNG-001") return BEWERBUNG_VERALTET;
  if (error.serverErrorCode !== "REQ-KONTAKT-001") return null;

  return buildRefusal({
    reason:
      "Die Kontakte dieser Saison wurden inzwischen geändert, etwa weil eine Kontaktperson ihren Eintrag bestätigt oder ihm widersprochen hat oder gelöscht wurde",
    repair: "Lade die Seite neu und trage Deine Änderung dort erneut ein",
  });
}
