import { BEWERBUNG_VERALTET } from "@/features/bewerbungen/utils";
import { SPERRLISTE_ADRESSE_GESPERRT } from "@/features/sperrliste/constants";
import { isRefusal } from "@/shared/utils/actionError";
import { buildRefusal, LADE_DIE_SEITE_NEU } from "@/shared/utils/refusal";

/**
 * The re-send's refusal, or `null` when the refusal is something else. The editor offers the press
 * only on a filled, unconfirmed seat, so each code here is that seat moving after the page was read.
 */
export function mapEinladenRefusal(error: unknown): string | null {
  if (!isRefusal(error)) return null;

  switch (error.serverErrorCode) {
    // The application page's re-send words its twin refusal so (`fl_frontend/src/features/bewerbungen/refusals.ts`).
    case "REQ-KONTAKT-002":
      return buildRefusal({
        reason: "Für diese Rolle steht keine Bestätigung mehr aus",
        repair: LADE_DIE_SEITE_NEU,
      });
    case "REQ-KONTAKT-003":
      return SPERRLISTE_ADRESSE_GESPERRT;
    // The editor offers no send on a row whose season is over or whose team has left it, so this
    // answers a page read before that change, which the reload shows.
    case "REQ-KONTAKT-005":
      return buildRefusal({
        reason: "Diese Saison ist vorbei oder das Team ist ausgetreten",
        repair: "Lade die Seite neu, um den aktuellen Stand zu sehen",
      });
    default:
      return null;
  }
}

/**
 * The save's refusal, or `null` when the refusal is something else. None lands on a field: the stale
 * block puts the whole screen behind the row, and the ban names no seat.
 */
export function mapKontakteRefusal(error: unknown): string | null {
  if (!isRefusal(error)) return null;

  switch (error.serverErrorCode) {
    // The backend's judgement of a seat's label (`docs/backend/spec.md :: I610`): an editor opened
    // before a deploy moved the form's label sends it for a person the row did not hold.
    case "REQ-EINWILLIGUNG-001":
      return BEWERBUNG_VERALTET;
    case "REQ-KONTAKT-001":
      return buildRefusal({
        reason:
          "Die Kontakte dieser Saison wurden inzwischen geändert, etwa weil eine Kontaktperson ihren Eintrag bestätigt oder ihm widersprochen hat oder gelöscht wurde",
        repair: "Lade die Seite neu und trage Deine Änderung dort erneut ein",
      });
    // Not the re-send's sentence: the refusal names no seat, so „Diese E-Mail-Adresse“ would point at none.
    case "REQ-KONTAKT-003":
      return buildRefusal({
        reason: "Eine neu eingetragene E-Mail-Adresse steht auf der Sperrliste",
        repair: "Trage dort eine andere Adresse ein oder hebe die Sperre unter /bereich/admin/sperrliste auf",
      });
    default:
      return null;
  }
}

export const KONTAKTE_REPLAY_REFUSALS: Readonly<Record<string, string>> = {
  // Only a deploy between the label's read and the write leaves the replay naming a label the backend
  // has moved past (`docs/backend/spec.md :: I610`).
  "REQ-EINWILLIGUNG-001":
    "Die Rücknahme würde eine Kontaktperson unter einer Fassung der Hinweise eintragen, die nicht mehr gilt. " +
    "Sie wurde nicht ausgeführt. Lade die Seite neu und trage die Kontakte dort erneut ein.",
  // The replay seats an earlier person anew, which the backend refuses for an address barred since.
  "REQ-KONTAKT-003":
    "Die Rücknahme würde eine Kontaktperson eintragen, deren E-Mail-Adresse inzwischen auf der Sperrliste steht. Sie wurde nicht ausgeführt.",
};

/**
 * Its own close, the one undo row without the change standing: it already says the undo did not run,
 * and why. Worded for the undo, whose toast has not got the save's form.
 */
export const STALE_BLOCK_REFUSAL: Readonly<Record<string, string>> = {
  "REQ-KONTAKT-001":
    "Die Kontakte dieser Saison wurden nach dem Speichern erneut geändert, etwa weil eine Kontaktperson ihren Eintrag bestätigt oder ihm widersprochen hat oder gelöscht wurde. " +
    "Die Rücknahme wurde nicht ausgeführt, damit sie die neueren Angaben nicht überschreibt.",
};
