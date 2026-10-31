import {
  saisonsPostInvitationsDispatch,
  teamsDeleteInvitation,
  teamsPostInvitation,
  teamsPostInvitationDispatch,
} from "@/core/generated/client/sdk";

import type {
  FLInvitationDispatchPayload,
  FLInvitationDispatchResponse,
  FLInvitationMailResponse,
  FLInvitationMintResponse,
  FLInvitationWriteResponse,
} from "@/core/generated/client/types";

// Both ids go in the PATH, never the body — a backend payload model that saw one refuses the whole
// body.
/** Mints, revoking any live invite of that team and season in the same transaction, and answers the raw link value once. */
export async function postEinladung({ team_id, saison_id }: { team_id: string; saison_id: string }): Promise<FLInvitationMintResponse> {
  return teamsPostInvitation(team_id, saison_id);
}

/** Closes the live invite. Soft, as every removal here is: the row keeps its history and stops opening anything. */
export async function deleteEinladung({ team_id, saison_id }: { team_id: string; saison_id: string }): Promise<FLInvitationWriteResponse> {
  return teamsDeleteInvitation(team_id, saison_id);
}

/** Owes the team's live link to its confirmed seats; each mail mints a link of its own beside the copied one. */
export async function mailEinladung({
  team_id,
  saison_id,
  einladung_id,
}: {
  team_id: string;
  saison_id: string;
  einladung_id: string;
}): Promise<FLInvitationMailResponse> {
  return teamsPostInvitationDispatch(team_id, saison_id, { invitation_id: einladung_id });
}

/**
 * The SEASON's resource, not a loop over the teams': the unit of work is the season, and a per-team
 * route would be the loop this press exists to remove.
 */
export async function postEinladungVersand({
  id,
  resend: erneut,
}: { id: string } & FLInvitationDispatchPayload): Promise<FLInvitationDispatchResponse> {
  return saisonsPostInvitationsDispatch(id, { resend: erneut });
}
