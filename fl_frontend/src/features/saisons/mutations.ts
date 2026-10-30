import {
  identitaetSweepLoeschung,
  saisonsActivateSaison,
  saisonsDeleteSpielplan,
  saisonsPatchSaison,
  saisonsPostSaison,
  saisonsPostSpielplan,
  saisonsSwapGruppen,
} from "@/core/generated/client/sdk";

import type {
  FLActivateSaisonResponse,
  FLGenerateSpielplanPayload,
  FLGenerateSpielplanResponse,
  FLLoeschungLaufResponse,
  FLPatchSaisonPayload,
  FLPatchSaisonResponse,
  FLPostSaisonPayload,
  FLPostSaisonResponse,
  FLSwapGruppenPayload,
  FLSwapGruppenResponse,
  FLUndrawSpielplanResponse,
} from "@/core/generated/client/types";

// The one create whose payload carries its own id: `saisons._id` is chosen rather than generated, so
// a reuse is refused by the index and comes back as `duplicate_key`, no rule's code.
export async function postSaison({
  id,
  start_date,
  end_date,
  rules,
  bewerbung,
  registrierung,
}: FLPostSaisonPayload): Promise<FLPostSaisonResponse> {
  return saisonsPostSaison({ id, start_date, end_date, rules, bewerbung, registrierung });
}

/** The old editor's payload: the write's body beside the season it names, which the path carries. */
export async function patchSaison({
  id,
  start_date,
  end_date,
  rules,
  bewerbung,
  registrierung,
}: FLPatchSaisonPayload & { id: string }): Promise<FLPatchSaisonResponse> {
  return saisonsPatchSaison(id, { start_date, end_date, rules, bewerbung, registrierung });
}

/** Promotes this season and demotes the incumbent in one transaction. No body: the id is the whole argument. */
export async function activateSaison({ id }: { id: string }): Promise<FLActivateSaisonResponse> {
  return saisonsActivateSaison(id);
}

/**
 * Draws the season's matchdays and fixtures in one transaction. **`replace` makes the same call
 * DESTRUCTIVE** and nothing writes the removed rows back. `shape`
 * moves the three shape rules with them. Nothing here retries on a 409.
 */
export async function generateSpielplan({
  id,
  replace,
  shape,
}: FLGenerateSpielplanPayload & { id: string }): Promise<FLGenerateSpielplanResponse> {
  // `{}` where the caller named no flag, which the endpoint reads as the first draw: a key left `undefined` is
  // dropped by the serialisation.
  return saisonsPostSpielplan(id, { replace, shape });
}

/**
 * Removes the season's matchdays, fixtures and watermark in one transaction. **Destructive with no
 * inverse**. No body: the id is the whole argument.
 */
export async function undrawSpielplan({ id }: { id: string }): Promise<FLUndrawSpielplanResponse> {
  return saisonsDeleteSpielplan(id);
}

/**
 * **One request and not two junction PATCHes.** Two calls leave a window in which one group is a club
 * short and the other a club over, permanently so if the second fails. The same transaction rewrites
 * the two clubs' drawn Gruppenphase sides.
 */
export async function swapGruppen({
  saison_id,
  team1_id,
  team2_id,
}: FLSwapGruppenPayload & { saison_id: string }): Promise<FLSwapGruppenResponse> {
  return saisonsSwapGruppen(saison_id, { team1_id, team2_id });
}

/**
 * The system tier, whoever presses: the season-after rule deletes, never the administrator who activated a
 * season. No season in the call, which reads the statuses itself; `nach` is the previous call's answer.
 */
export async function postLoeschungLauf(nach: string | null): Promise<FLLoeschungLaufResponse> {
  // Left out on a pass's first call: the server takes `nach` as an id wherever it is present.
  return identitaetSweepLoeschung(nach === null ? {} : { nach: nach });
}
