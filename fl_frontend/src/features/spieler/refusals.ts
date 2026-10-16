import { isRecordMissing } from "@/core/errors";
import { SPERRLISTE_ADRESSE_GESPERRT } from "@/features/sperrliste/constants";
import { isRefusal } from "@/shared/utils/actionError";
import { buildRefusal, LADE_DIE_SEITE_NEU } from "@/shared/utils/refusal";

import { ADRESSE_AENDERN, ALREADY_IN_SAISON, KADER_ABSCHNITT, STUFE_NICHT_ZUGELASSEN } from "./constants";

import type { FieldErrors } from "@/shared/utils/validation";

// Reachable with no picker on screen: a reactivate names the row's STORED club, which a replacement
// can have taken out of the season.
const SQUAD_TEAM_NOT_IN_SAISON =
  `Das Team dieses Kadereintrags ist in dieser Saison nicht dabei. Weise den Eintrag im Bereich „${KADER_ABSCHNITT}“ auf der Seite ` +
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
 * `null` for any code but the unique index's, which on the junction's key spans retired rows: the
 * player already stands in the season.
 */
export function mapAlreadyInSaisonRefusal(error: unknown): string | null {
  if (!isRefusal(error) || error.serverErrorCode !== "DB-COMMON-002") return null;

  return ALREADY_IN_SAISON;
}

const ADRESSE_BELEGT = "Diese Adresse ist schon bei einer anderen Spielerin oder einem anderen Spieler hinterlegt.";

const SCHON_HINTERLEGT = "Das ist schon die hinterlegte Adresse.";

/** Shown where the control is missing too: a pupil holding no address takes no change, and the panel says where one comes from. */
export const KEINE_ADRESSE_HINTERLEGT =
  "Für diesen Eintrag ist keine Adresse hinterlegt. Sie kommt mit der Registrierung über den Link des Teams.";

const EINTRAG_WEG = buildRefusal({ reason: "Diesen Eintrag gibt es nicht mehr", repair: LADE_DIE_SEITE_NEU });

/**
 * An address change's request, or `null`. The address's own refusals land on the box that holds it,
 * which is itself the way out; the other two on no field, the box being no part of either.
 */
export function mapAdresswechselAntragRefusal(error: unknown): { error?: string; fieldErrors?: FieldErrors } | null {
  if (isRecordMissing(error)) return { error: EINTRAG_WEG };
  if (!isRefusal(error)) return null;

  switch (error.serverErrorCode) {
    case "REQ-SPIELER-003":
      return { error: SPERRLISTE_ADRESSE_GESPERRT, fieldErrors: { email: SPERRLISTE_ADRESSE_GESPERRT } };
    case "REQ-SPIELER-006":
      return { error: ADRESSE_BELEGT, fieldErrors: { email: ADRESSE_BELEGT } };
    case "REQ-SPIELER-007":
      return { error: SCHON_HINTERLEGT, fieldErrors: { email: SCHON_HINTERLEGT } };
    // No address control stands where none is stored, so only a page older than the address's removal sends this.
    case "REQ-SPIELER-008":
      return { error: KEINE_ADRESSE_HINTERLEGT };
    default:
      return null;
  }
}

/**
 * The pending change's re-send and discard, or `null`. A change answered, replaced or discarded since
 * the page loaded is the 404 both answer, and the page holding a stale panel is the repair.
 */
export function mapAdresswechselLinkRefusal(error: unknown): string | null {
  if (isRecordMissing(error)) return KEIN_ADRESSWECHSEL;
  if (!isRefusal(error)) return null;

  switch (error.serverErrorCode) {
    case "REQ-SPIELER-003":
      return SPERRLISTE_ADRESSE_GESPERRT;
    // The panel has no box, so the sentence names the two ways out it does hold.
    case "REQ-SPIELER-006":
      return `${ADRESSE_BELEGT} Verwirf die Änderung oder gib unter „${ADRESSE_AENDERN}“ eine andere ein.`;
    // A stored address emptied under a waiting change, which only a hand edit reaches: the link would
    // be refused at the confirmation, so the discard is the one way out.
    case "REQ-SPIELER-008":
      return KEINE_ADRESSE_ZU_ERSETZEN;
    default:
      return null;
  }
}

const KEINE_ADRESSE_ZU_ERSETZEN = buildRefusal({
  reason: "Für diesen Eintrag ist keine Adresse hinterlegt, deshalb lässt sich keine neue bestätigen",
  repair: "Verwirf die Änderung",
});

const KEIN_ADRESSWECHSEL = buildRefusal({
  reason: "Für diesen Eintrag wartet keine neue E-Mail-Adresse mehr auf Bestätigung",
  repair: LADE_DIE_SEITE_NEU,
});

/**
 * The refusals the squad half of a replay can meet, in German written for the undo — the save's own
 * words send an admin to the team picker, which this toast has not got.
 */
export const SQUAD_REPLAY_REFUSALS: Readonly<Record<string, string>> = {
  "REQ-SQUAD-001": "Das ursprüngliche Team dieses Kadereintrags nimmt nicht mehr an dieser Saison teil.",
  "REQ-SQUAD-003": "Der Kader des ursprünglichen Teams ist für diese Saison inzwischen voll.",
  "REQ-SQUAD-004": "Die ursprüngliche Rolle ist in diesem Team inzwischen an einen anderen Spieler vergeben.",
};
