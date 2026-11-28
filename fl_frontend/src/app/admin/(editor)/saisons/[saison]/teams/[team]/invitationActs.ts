"use server";

import { z } from "zod";

import { action } from "@/core/action";
import { frontend_config } from "@/core/config";
import { ADMIN_COPY } from "@/core/copy/admin";
import { teamsDeleteInvitation, teamsPostInvitation, teamsPostInvitationMail } from "@/core/generated/client/sdk";
import { TeamsPostInvitationMailBody, TeamsPostInvitationParams } from "@/core/generated/zod/inputs";
import { mailedLinkTo, ROUTES } from "@/core/routes";

const Key = z.object(TeamsPostInvitationParams.shape);

/**
 * Voids any live link in the same transaction. The raw link is answered once and stored nowhere, so the box showing it
 * holds the only copy anybody will ever see. Spelled here and never in the box: `frontend_config.AUTH_URL` is
 * server-only, and a link built in the browser would carry whichever host the page was opened on.
 */
export const mintInvitation = action({
  lane: "admin",
  name: "mintInvitation",
  input: Key,
  run: async ({ team_id, saison_id }) => {
    const { token } = await teamsPostInvitation(team_id, saison_id);
    return { ok: true, value: { link: mailedLinkTo(new URL(frontend_config.AUTH_URL).origin, ROUTES.registrierung, token) } };
  },
});

/**
 * Owes the team's live link to its confirmed seats. Each mail mints a link of its own when it leaves, so a copied one
 * stays valid beside them. A link replaced or withdrawn since the page was read is the stale page it is, and a press
 * reaching nobody says so, having sent nothing.
 */
export const mailInvitation = action({
  lane: "admin",
  name: "mailInvitation",
  input: Key.extend(TeamsPostInvitationMailBody.shape),
  run: async ({ team_id, saison_id, invitation_id }) => {
    const { mailed } = await teamsPostInvitationMail(team_id, saison_id, { invitation_id });
    return mailed === 0 ? { ok: false, reason: ADMIN_COPY.saison.noConfirmedAddress } : { ok: true, value: undefined };
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
