import { isRefusal } from "@/shared/utils/actionError";
import { buildRefusal } from "@/shared/utils/refusal";

import { ALREADY_IN_SAISON, KADER_ABSCHNITT, STUFE_NICHT_ZUGELASSEN } from "./constants";

import type { FieldErrors } from "@/shared/utils/validation";

// Reachable with no picker on screen: a reactivate names the row's STORED club, which a replacement
// can have taken out of the season.
const KADER_TEAM_NOT_IN_SAISON =
  `Das Team dieses Kadereintrags ist in dieser Saison nicht dabei. Weise den Eintrag im Bereich „${KADER_ABSCHNITT}“ auf der Seite ` +
  "des Spielers zuerst einem Team dieser Saison zu.";

// Neither role is named: the reactivate offers no role on screen, and one sentence has to serve it
// as well as the two the editor picks between.
const KADER_ROLLE_TAKEN = buildRefusal({
  reason: "In diesem Team ist diese Rolle schon vergeben",
  repair: "Nimm sie dem anderen Spieler zuerst ab, dann kannst Du sie hier vergeben",
});

/**
 * Two shapes for one refusal: the field message marks the team picker, and the sentence beside it is
 * what a reactivate toasts, that path rendering no field at all. Neither the cap nor a taken role
 * belongs to a field — one is a fact about the season's rules, the other about the squad.
 */
export function mapSquadRefusal(error: unknown): { error?: string; fieldErrors?: FieldErrors } | null {
  if (!isRefusal(error)) return null;

  if (error.serverErrorCode === "kader_team_not_in_saison") {
    return { error: KADER_TEAM_NOT_IN_SAISON, fieldErrors: { team_id: "Dieses Team ist in der gewählten Saison nicht dabei." } };
  }
  if (error.serverErrorCode === "kader_rolle_taken") {
    return { error: KADER_ROLLE_TAKEN };
  }
  if (error.serverErrorCode === "kader_full") {
    return {
      error: buildRefusal({
        reason: "Der Kader dieses Teams ist für diese Saison voll",
        repair: "Erhöhe die maximale Kadergröße in den Saisonregeln oder trage zuerst einen anderen Spieler aus",
      }),
    };
  }
  return null;
}

/**
 * A seat holder's squad edit, worded for a repair they can make. The cap is absent: a live row moved
 * inside its own squad never crosses it. A lost seat and a ban are the shared reader's.
 */
export function mapKaderZeileRefusal(error: unknown): { error?: string; fieldErrors?: FieldErrors } | null {
  if (!isRefusal(error)) return null;

  if (error.serverErrorCode === "kader_rolle_taken") return { error: KADER_ROLLE_TAKEN };
  // On the picker as well as in the sentence: the form offers the season's levels, so only a season
  // narrowed under the open page reaches this, and the picker is where it is repaired.
  if (error.serverErrorCode === "kader_stufe_not_allowed")
    return { error: STUFE_NICHT_ZUGELASSEN, fieldErrors: { stufe: STUFE_NICHT_ZUGELASSEN } };
  return null;
}

/**
 * `null` for any code but the unique index's, which on the junction's key spans retired rows: the
 * player already stands in the season.
 */
export function mapAlreadyInSaisonRefusal(error: unknown): string | null {
  if (!isRefusal(error) || error.serverErrorCode !== "duplicate_key") return null;

  return ALREADY_IN_SAISON;
}
