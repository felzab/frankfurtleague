"use server";

import { z } from "zod";

import { action } from "@/core/action";
import { frontend_config } from "@/core/config";
import { COPY } from "@/core/copy";
import { teamsDeleteInvitation, teamsPostInvitation, teamsPostInvitationDispatch } from "@/core/generated/client/sdk";
import { TeamsPostInvitationDispatchBody, TeamsPostInvitationParams } from "@/core/generated/zod/inputs";
import { invitationLink } from "@/core/invitationEmail";

/** Which team's link, in which season. */
const Key = z.object(TeamsPostInvitationParams.shape);

/**
 * Mints the team's link for the season, voiding any live one in the same transaction. **The raw link is answered once
 * and stored nowhere**, so the box showing it holds the only copy anybody will ever see. Spelled here and never in the
 * box: `frontend_config.AUTH_URL` is server-only, and a link built in the browser would carry whichever host the page was
 * opened on.
 */
export const mintInvitation = action({
  lane: "admin",
  name: "mintInvitation",
  input: Key,
  ownWords: ["saison_past"],
  run: async ({ team_id, saison_id }) => {
    const { token } = await teamsPostInvitation(team_id, saison_id);
    return { ok: true, value: { link: invitationLink(new URL(frontend_config.AUTH_URL).origin, token) } };
  },
});

/**
 * Owes the team's live link to its confirmed seats, the press the box offers beside the mint. Each mail mints a link of
 * its own when it leaves, so a copied one stays valid beside them. A link replaced or withdrawn since the page was read
 * is the stale page it is, and a press reaching nobody says so, having sent nothing.
 */
export const mailInvitation = action({
  lane: "admin",
  name: "mailInvitation",
  input: Key.extend(TeamsPostInvitationDispatchBody.shape),
  run: async ({ team_id, saison_id, invitation_id }) => {
    const { recipient } = await teamsPostInvitationDispatch(team_id, saison_id, { invitation_id });
    return recipient.length === 0
      ? { ok: false, reason: COPY.admin.saison.noConfirmedAddress }
      : { ok: true, value: undefined, note: COPY.shared.toast.linkSent };
  },
});

/** Closes the team's live link. Nothing reverses it: the next link is a fresh mint with a fresh value. */
export const revokeInvitation = action({
  lane: "admin",
  name: "revokeInvitation",
  input: Key,
  run: async ({ team_id, saison_id }) => {
    await teamsDeleteInvitation(team_id, saison_id);
    return { ok: true, value: undefined };
  },
});
