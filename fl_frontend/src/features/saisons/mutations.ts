import { apiClient } from "@/core/api";

import {
  FLActivateSaisonResponseSchema,
  FLGenerateSpielplanResponseSchema,
  FLLoeschungLaufResponseSchema,
  FLPatchSaisonResponseSchema,
  FLPostSaisonResponseSchema,
  FLSwapGruppenResponseSchema,
  FLUndrawSpielplanResponseSchema,
} from "./schemas";

import type {
  FLActivateSaisonPayload,
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
  FLUndrawSpielplanPayload,
  FLUndrawSpielplanResponse,
} from "./schemas";

// The one create whose payload carries its own id: `saisons._id` is chosen rather than generated, so
// a reuse is refused by the index and comes back as `DB-COMMON-002`, no rule's code.
export async function postSaison(payload: FLPostSaisonPayload): Promise<FLPostSaisonResponse> {
  return apiClient<FLPostSaisonResponse>("/saisons", FLPostSaisonResponseSchema, {
    method: "POST",
    authType: "admin",
    body: JSON.stringify(payload),
  });
}

export async function patchSaison({ id, ...fields }: FLPatchSaisonPayload): Promise<FLPatchSaisonResponse> {
  return apiClient<FLPatchSaisonResponse>(`/saisons/${id}`, FLPatchSaisonResponseSchema, {
    method: "PATCH",
    authType: "admin",
    body: JSON.stringify(fields),
  });
}

/** Promotes this season and demotes the incumbent in one transaction. No body: the id is the whole argument. */
export async function activateSaison({ id }: FLActivateSaisonPayload): Promise<FLActivateSaisonResponse> {
  return apiClient<FLActivateSaisonResponse>(`/saisons/${id}/activate`, FLActivateSaisonResponseSchema, {
    method: "POST",
    authType: "admin",
  });
}

/**
 * Draws the season's matchdays and fixtures in one transaction. **`replace` makes the same call
 * DESTRUCTIVE** and nothing writes the removed rows back (`docs/backend/spec.md :: I26`). `shape`
 * moves the three shape rules with them. Nothing here retries on a 409.
 */
export async function generateSpielplan({ id, ...confirmation }: FLGenerateSpielplanPayload): Promise<FLGenerateSpielplanResponse> {
  return apiClient<FLGenerateSpielplanResponse>(`/saisons/${id}/spielplan`, FLGenerateSpielplanResponseSchema, {
    method: "POST",
    authType: "admin",
    // `{}` where the caller named no flag, which the endpoint reads as the first draw.
    body: JSON.stringify(confirmation),
  });
}

/**
 * Removes the season's matchdays, fixtures and watermark in one transaction. **Destructive with no
 * inverse** (`docs/backend/spec.md :: I26`). No body: the id is the whole argument.
 */
export async function undrawSpielplan({ id }: FLUndrawSpielplanPayload): Promise<FLUndrawSpielplanResponse> {
  return apiClient<FLUndrawSpielplanResponse>(`/saisons/${id}/spielplan`, FLUndrawSpielplanResponseSchema, {
    method: "DELETE",
    authType: "admin",
  });
}

/**
 * **One request and not two junction PATCHes.** Two calls leave a window in which one group is a club
 * short and the other a club over, permanently so if the second fails. The same transaction rewrites
 * the two clubs' drawn Gruppenphase sides.
 */
export async function swapGruppen({ saison_id, ...teams }: FLSwapGruppenPayload): Promise<FLSwapGruppenResponse> {
  return apiClient<FLSwapGruppenResponse>(`/saisons/${saison_id}/gruppen/swap`, FLSwapGruppenResponseSchema, {
    method: "POST",
    authType: "admin",
    body: JSON.stringify(teams),
  });
}

/**
 * The system tier, whoever presses: the season-after rule deletes, never the administrator who activated a
 * season. No season in the call, which reads the statuses itself.
 */
export async function postLoeschungLauf(): Promise<FLLoeschungLaufResponse> {
  return apiClient<FLLoeschungLaufResponse>("/identitaet/loeschung/lauf", FLLoeschungLaufResponseSchema, {
    method: "POST",
    authType: "system",
  });
}

/**
 * Every call of one run summed, the last answered call's season and remainder beside the sums. A person who fails
 * stays due and meets each later call, so `fehlgeschlagen` and `uebersprungen` count attempts, never persons.
 */
type LoeschungSumme = Omit<FLLoeschungLaufResponse, "acknowledged">;

/** A run that ended on a call's answer, or on a call that threw: what remains is then unknown. */
export type LoeschungLauf =
  (LoeschungSumme & { abgebrochen: false }) | (Omit<LoeschungSumme, "verbleibend"> & { abgebrochen: true; fehler: unknown });

/** Settles rather than throws, so a caller words what the calls before a failure erased. */
export async function loeschungLaufen(lauf: () => Promise<FLLoeschungLaufResponse>): Promise<LoeschungLauf> {
  let summe: LoeschungSumme = {
    abgeschlossene_saison_id: null,
    spieler: 0,
    saison_spieler: 0,
    registrierungen: 0,
    uebersprungen: 0,
    fehlgeschlagen: 0,
    verbleibend: 0,
  };

  try {
    let antwort: FLLoeschungLaufResponse;
    do {
      antwort = await lauf();
      summe = {
        abgeschlossene_saison_id: antwort.abgeschlossene_saison_id,
        spieler: summe.spieler + antwort.spieler,
        saison_spieler: summe.saison_spieler + antwort.saison_spieler,
        registrierungen: summe.registrierungen + antwort.registrierungen,
        uebersprungen: summe.uebersprungen + antwort.uebersprungen,
        fehlgeschlagen: summe.fehlgeschlagen + antwort.fehlgeschlagen,
        verbleibend: antwort.verbleibend,
      };
      // Never `verbleibend` alone: a person whose erasure fails stays due, and every later call meets them again.
    } while (antwort.verbleibend > 0 && antwort.spieler > 0);
  } catch (fehler) {
    const { verbleibend: _unbekannt, ...bisher } = summe;
    return { ...bisher, abgebrochen: true, fehler: fehler };
  }

  return { ...summe, abgebrochen: false };
}
