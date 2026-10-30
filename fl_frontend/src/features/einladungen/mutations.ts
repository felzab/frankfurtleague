import { saisonsPostEinladungenVersand, teamsDeleteEinladung, teamsPostEinladung } from "@/core/generated/client/sdk";

import type {
  FLEinladungMintResponse,
  FLEinladungVersandPayload,
  FLEinladungVersandResponse,
  FLEinladungWriteResponse,
} from "@/core/generated/client/types";

// Both ids go in the PATH, never the body — a backend payload model that saw one refuses the whole
// body.
/** Mints, revoking any live invite of that team and season in the same transaction, and answers the raw link value once. */
export async function postEinladung({ team_id, saison_id }: { team_id: string; saison_id: string }): Promise<FLEinladungMintResponse> {
  return teamsPostEinladung(team_id, saison_id);
}

/** Closes the live invite. Soft, as every removal here is: the row keeps its history and stops opening anything. */
export async function deleteEinladung({ team_id, saison_id }: { team_id: string; saison_id: string }): Promise<FLEinladungWriteResponse> {
  return teamsDeleteEinladung(team_id, saison_id);
}

/**
 * The SEASON's resource, not a loop over the teams': the unit of work is the season, and a per-team
 * route would be the loop this press exists to remove.
 */
export async function postEinladungVersand({ id, erneut }: { id: string } & FLEinladungVersandPayload): Promise<FLEinladungVersandResponse> {
  return saisonsPostEinladungenVersand(id, { erneut: erneut });
}
