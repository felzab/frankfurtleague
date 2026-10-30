import {
  teamsDeleteTeam,
  teamsPatchSaisonTeam,
  teamsPatchTeam,
  teamsPostSaisonTeam,
  teamsPostTeam,
  teamsReactivateTeam,
  teamsReplaceSaisonTeam,
} from "@/core/generated/client/sdk";

import type {
  FLCreatedResponse,
  FLPatchSaisonTeamPayload,
  FLPatchTeamPayload,
  FLPatchTeamResponse,
  FLPostSaisonTeamPayload,
  FLPostTeamPayload,
  FLReplaceSaisonTeamPayload,
  FLReplaceSaisonTeamResponse,
  FLSaisonTeamResponse,
  FLTeamWriteResponse,
} from "@/core/generated/client/types";

export async function postTeam({
  name,
  shorthand,
  description,
  full_name,
  website_url,
  address,
  schulform,
}: FLPostTeamPayload): Promise<FLCreatedResponse> {
  return teamsPostTeam({ name, shorthand, description, full_name, website_url, address, schulform });
}

// The id goes in the PATH, never the body — a backend payload model that saw one refuses the whole
// body.
export async function patchTeam({
  id,
  name,
  shorthand,
  description,
  full_name,
  website_url,
  address,
  schulform,
}: FLPatchTeamPayload & { id: string }): Promise<FLPatchTeamResponse> {
  return teamsPatchTeam(id, { name, shorthand, description, full_name, website_url, address, schulform });
}

// Soft: the backend stamps `inactive_since` and removes nothing.
export async function deleteTeam({ id }: { id: string }): Promise<FLTeamWriteResponse> {
  return teamsDeleteTeam(id);
}

// The one way back: creating never revives, because a shorthand cannot say WHICH club is meant. An id
// can, so reactivation names one and carries no body.
export async function reactivateTeam({ id }: { id: string }): Promise<FLTeamWriteResponse> {
  return teamsReactivateTeam(id);
}

// A POST and a PATCH and no DELETE: a team never leaves a season, and disqualification is the only
// way out.
export async function postSaisonTeam({
  team_id,
  saison_id,
  gruppe,
}: FLPostSaisonTeamPayload & { team_id: string }): Promise<FLSaisonTeamResponse> {
  return teamsPostSaisonTeam(team_id, { saison_id, gruppe });
}

export async function patchSaisonTeam({
  team_id,
  saison_id,
  gruppe,
  austritt,
  trikot_farbe,
}: FLPatchSaisonTeamPayload & { team_id: string; saison_id: string }): Promise<FLSaisonTeamResponse> {
  return teamsPatchSaisonTeam(team_id, saison_id, { gruppe, austritt, trikot_farbe });
}

// The row is addressed by its natural key and the club taking it over rides in the body: the path
// names the club going OUT, which is why a phantom row naming no club is repairable through here.
export async function replaceSaisonTeam({
  team_id,
  saison_id,
  incoming_team_id,
}: FLReplaceSaisonTeamPayload & { team_id: string; saison_id: string }): Promise<FLReplaceSaisonTeamResponse> {
  return teamsReplaceSaisonTeam(team_id, saison_id, { incoming_team_id });
}
