import { isRefusal } from "@/shared/utils/actionError";
import { buildRefusal } from "@/shared/utils/refusal";

import { STUFE_NICHT_ZUGELASSEN } from "./constants";

import type { FieldErrors } from "@/shared/utils/validation";

// Neither role is named: the reactivate offers no role on screen, and one sentence has to serve it
// as well as the two the editor picks between.
const KADER_ROLLE_TAKEN = buildRefusal({
  reason: "In diesem Team ist diese Rolle schon vergeben",
  repair: "Nimm sie dem anderen Spieler zuerst ab, dann kannst Du sie hier vergeben",
});

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
