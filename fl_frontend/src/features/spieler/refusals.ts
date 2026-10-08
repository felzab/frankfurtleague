import { isRefusal } from "@/shared/utils/actionError";
import { buildRefusal } from "@/shared/utils/refusal";

import { ALREADY_IN_SAISON, ERASURE_NEEDS_RETIREMENT, STUFE_NICHT_ZUGELASSEN } from "./constants";

import type { FieldErrors } from "@/shared/utils/validation";

// Reachable with no picker on screen: a reactivate names the row's STORED club, which a replacement
// can have taken out of the season.
const SQUAD_TEAM_NOT_IN_SAISON =
  "Das Team dieses Kadereintrags ist in dieser Saison nicht dabei. Weise den Eintrag im Bereich „Kader“ auf der Seite " +
  "des Spielers zuerst einem Team dieser Saison zu.";

// Neither role is named: the reactivate offers no role on screen, and one sentence has to serve it
// as well as the two the editor picks between.
const SQUAD_ROLLE_TAKEN = buildRefusal({
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

  if (error.serverErrorCode === "REQ-SQUAD-001") {
    return { error: SQUAD_TEAM_NOT_IN_SAISON, fieldErrors: { team_id: "Dieses Team ist in der gewählten Saison nicht dabei." } };
  }
  if (error.serverErrorCode === "REQ-SQUAD-004") {
    return { error: SQUAD_ROLLE_TAKEN };
  }
  if (error.serverErrorCode === "REQ-SQUAD-003") {
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

  if (error.serverErrorCode === "REQ-SQUAD-004") return { error: SQUAD_ROLLE_TAKEN };
  // On the picker as well as in the sentence: the form offers the season's levels, so only a season
  // narrowed under the open page reaches this, and the picker is where it is repaired.
  if (error.serverErrorCode === "REQ-SQUAD-005") return { error: STUFE_NICHT_ZUGELASSEN, fieldErrors: { stufe: STUFE_NICHT_ZUGELASSEN } };
  return null;
}

/**
 * The erasure's precondition, or `null` when the refusal is something else. It lands on no field: the
 * control is a panel with nothing to fill in, and the repair it names is on another page.
 */
export function mapErasureRefusal(error: unknown): string | null {
  if (!isRefusal(error)) return null;

  if (error.serverErrorCode === "REQ-PURGE-001") return ERASURE_NEEDS_RETIREMENT;
  return null;
}

/**
 * `null` for any code but the unique index's, which on the junction's key spans retired rows: the
 * player already stands in the season.
 */
export function mapAlreadyInSaisonRefusal(error: unknown): string | null {
  if (!isRefusal(error) || error.serverErrorCode !== "DB-COMMON-002") return null;

  return ALREADY_IN_SAISON;
}

/**
 * The refusals the squad half of a replay can meet, in German written for the undo — the save's own
 * words send an admin to the team picker, which this toast has not got.
 */
export const SQUAD_REPLAY_REFUSALS: Readonly<Record<string, string>> = {
  "REQ-SQUAD-001": "Das ursprüngliche Team dieses Kadereintrags nimmt nicht mehr an dieser Saison teil.",
  "REQ-SQUAD-003": "Der Kader des ursprünglichen Teams ist für diese Saison inzwischen voll.",
  "REQ-SQUAD-004": "Die ursprüngliche Rolle ist in diesem Team inzwischen an einen anderen Spieler vergeben.",
};
