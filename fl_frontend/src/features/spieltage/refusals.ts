import { isRefusal } from "@/shared/utils/actionError";
import { buildRefusal } from "@/shared/utils/refusal";

import type { FieldErrors } from "@/shared/utils/validation";

/** Every refusal an edit can draw, in German, or `null` when none applies. */
export function mapSpieltagRefusal(error: unknown): { error?: string; fieldErrors?: FieldErrors } | null {
  if (!isRefusal(error)) return null;

  if (error.serverErrorCode === "REQ-DATE-002") {
    return { fieldErrors: { beginn: "Dieser Zeitraum liegt außerhalb des Zeitraums der Saison." } };
  }
  if (error.serverErrorCode === "REQ-DATE-003") {
    return {
      error: buildRefusal({
        reason: "Mindestens ein Spiel dieses Spieltags liegt außerhalb des neuen Zeitraums",
        repair: "Erweitere den Zeitraum wieder oder verlege diese Spiele",
      }),
    };
  }
  // One code carries both arms and the wire names neither, so the remedy is pinned to the matchday
  // the admin means to play later, the one referent that lands right in both. `ende` is the field
  // the rule leaves free, and only the dated rows are named.
  if (error.serverErrorCode === "REQ-DATE-008") {
    return {
      error:
        "Der Beginn dieses Spieltags muss in die Reihenfolge der Spieltage seiner Phase passen, die schon einen Zeitraum haben. " +
        "Das Ende ist daran nicht gebunden und darf weiter reichen. Verlege die Spiele des Spieltags, der später gespielt werden " +
        "soll, in die späteren Tage seines Zeitraums.",
    };
  }
  return null;
}

/** The refusals a replay can meet, in German — none of them has a field to land on from a toast. */
export const SPIELTAG_REPLAY_REFUSALS: Readonly<Record<string, string>> = {
  "REQ-DATE-002": "Der ursprüngliche Zeitraum liegt nicht mehr im Zeitraum der Saison.",
  "REQ-DATE-003": "Mindestens ein Spiel dieses Spieltags liegt außerhalb des ursprünglichen Zeitraums.",
  "REQ-DATE-008":
    "Der ursprüngliche Beginn dieses Spieltags passt nicht mehr in die Reihenfolge der Spieltage seiner Phase, die schon einen Zeitraum haben.",
};
