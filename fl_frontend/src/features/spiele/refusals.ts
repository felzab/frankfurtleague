import { isRefusal } from "@/shared/utils/actionError";
import { buildRefusal } from "@/shared/utils/refusal";

import { CLASH_BUFFER_TEXT } from "./constants";

import type { FieldErrors } from "@/shared/utils/validation";

/**
 * The refusals a match write answers here. `spiel_outside_spieltag` and `booking_unconfirmed_schiedsrichter` land on the field that
 * caused each; the rest travel as a message, naming no single control. Every other code falls to
 * `fl_frontend/src/shared/utils/actionError.ts :: OCCUPANT_REFUSALS`.
 */
export function mapSpielRefusal(error: unknown): { error?: string; fieldErrors?: FieldErrors } | null {
  if (!isRefusal(error)) return null;

  if (error.serverErrorCode === "spiel_outside_spieltag") {
    return { fieldErrors: { datum: "Dieses Datum liegt außerhalb des Spieltags." } };
  }
  // The referee alone, so the picker takes it: a kept one too, which a lifted call-off or a cleared result books again.
  if (error.serverErrorCode === "booking_unconfirmed_schiedsrichter") {
    return {
      fieldErrors: {
        // One sentence: picking another referee is the box's own repair.
        "schiedsrichter.schiedsrichter_id": "Diese Schiedsrichterin oder dieser Schiedsrichter hat den eigenen Eintrag noch nicht bestätigt.",
      },
    };
  }
  if (error.serverErrorCode === "ergebnis_side_emptied") {
    return {
      error: buildRefusal({
        reason: "Dieses Spiel hat ein Ergebnis, deshalb lässt sich das Team nicht entfernen",
        repair: "Wähle ein anderes Team, oder lösche zuerst die Tore",
      }),
    };
  }
  // One code covers both references and the failure body names neither, so the message names both.

  // A reactivation is one of two ways out rather than the way out: the row an erasure repoints a
  // fixture at is permanently retired, and a repair promising one sends a teacher into a refusal.
  if (error.serverErrorCode === "booking_unknown_resource") {
    return {
      error: buildRefusal({
        // The second clause for the save that picked nothing: lifting a call-off or clearing a result
        // books the fixture's own venue and referee again.
        reason:
          "Spielort oder Schiedsrichter ist stillgelegt oder gelöscht und kann keinem Spiel neu zugeteilt werden, auch keinem, dessen Absage oder Ergebnis Du gerade entfernst",
        repair: "Wähle einen anderen, oder reaktiviere den Eintrag, falls er nur stillgelegt ist",
      }),
    };
  }
  // Never on the picker: the draft's own choice is not at fault, the slot moved under it.
  if (error.serverErrorCode === "booking_schiedsrichter_moved") {
    return {
      error: buildRefusal({
        reason: "Die Schiedsrichtereinteilung dieses Spiels hat sich geändert, seit Du es geöffnet hast, etwa weil die Person abgesagt hat",
        repair: "Lade die Seite neu und trage Deine Änderung dort erneut ein",
      }),
    };
  }
  if (error.serverErrorCode === "spiel_double_booked") {
    return {
      error: buildRefusal({
        reason: "Spielort oder Schiedsrichter ist zu dieser Zeit schon für ein anderes Spiel eingeteilt",
        repair: `Wähle eine Uhrzeit mit mindestens ${CLASH_BUFFER_TEXT} Abstand, oder teile das Spiel anders ein`,
      }),
    };
  }
  // Mapped here rather than beside `spieltag_occupied` in the shared fallback: that sentence points at
  // the team the admin just picked, and this refusal is about a slot the KO-Baum fills by itself.
  if (error.serverErrorCode === "spieltag_occupied_by_the_resolution") {
    return {
      error: buildRefusal({
        // Never a result: `find_advancement_occupancy_refusal` runs on every save and every dry run,
        // so a re-pointed Herkunft raises this with no scoreline submitted at all.
        reason: "Mit dieser Änderung würde der KO-Baum ein Team in zwei Spielen desselben Spieltags aufstellen",
        // Neither appearance need be hand-set — the check reads the RESOLVED season, where the
        // wiring fills both — so the article stays indefinite and `Seite` names a fixture's side.
        repair: "Gib einer der beiden Seiten eine andere Herkunft, oder nimm ein von Hand gesetztes Team aus einem der beiden Spiele",
      }),
    };
  }
  return null;
}
