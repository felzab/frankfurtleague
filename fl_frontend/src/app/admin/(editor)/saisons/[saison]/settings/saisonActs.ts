"use server";

import { z } from "zod";

import { action, PAGE_HOLDER } from "@/core/action";
import { ADMIN_COPY } from "@/core/copy/admin";
import {
  saisonsActivateSaison,
  saisonsDeleteSpielplan,
  saisonsPostInvitationsMail,
  saisonsPostSpielplan,
  saisonsSwapGruppen,
  teamsReplaceSaisonTeam,
} from "@/core/generated/client/sdk";
import {
  SaisonsSwapGruppenBody,
  SaisonsSwapGruppenParams,
  TeamsReplaceSaisonTeamBody,
  TeamsReplaceSaisonTeamParams,
} from "@/core/generated/zod/inputs";

const SAISON = { saison_id: SaisonsSwapGruppenParams.shape.saison_id };

const OfSaison = z.object(SAISON);

/** An act on the passkey touch's list, naming its season and the address its page was drawn for. */
const TouchedOfSaison = z.object({ ...SAISON, ...PAGE_HOLDER });

/** Draws the season's Spielplan from its stored rules, a first draw, which the undraw takes back whole. */
export const drawSpielplan = action({
  lane: "admin",
  name: "drawSpielplan",
  input: OfSaison,
  run: async ({ saison_id }) => {
    await saisonsPostSpielplan(saison_id, { replace: false });
    return { ok: true, value: undefined };
  },
});

/** Deletes the season's matchdays and matches and draws them anew from its rules, behind the passkey touch. */
export const recreateSpielplan = action({
  lane: "admin",
  name: "recreateSpielplan",
  passkey: true,
  input: TouchedOfSaison,
  run: async ({ saison_id }) => {
    await saisonsPostSpielplan(saison_id, { replace: true });
    return { ok: true, value: undefined };
  },
});

/** Deletes the season's matchdays and matches, behind the passkey touch; nothing writes them back. */
export const deleteSpielplan = action({
  lane: "admin",
  name: "deleteSpielplan",
  passkey: true,
  input: TouchedOfSaison,
  run: async ({ saison_id }) => {
    await saisonsDeleteSpielplan(saison_id);
    return { ok: true, value: undefined };
  },
});

/** Makes this the season the site shows, closing the one it showed, behind the passkey touch. */
export const activateSaison = action({
  lane: "admin",
  name: "activateSaison",
  passkey: true,
  input: TouchedOfSaison,
  run: async ({ saison_id }) => {
    await saisonsActivateSaison(saison_id);
    return { ok: true, value: undefined };
  },
});

/** Exchanges two clubs' groups, every group match of either rewritten in the same write. */
export const swapGruppen = action({
  lane: "admin",
  name: "swapGruppen",
  input: SaisonsSwapGruppenBody.extend(SAISON),
  run: async ({ saison_id, ...pair }) => {
    await saisonsSwapGruppen(saison_id, pair);
    return { ok: true, value: undefined };
  },
});

/** Hands a club's row of the season, and its whole schedule, to a club the season does not hold. */
export const replaceTeam = action({
  lane: "admin",
  name: "replaceTeam",
  input: TeamsReplaceSaisonTeamBody.extend({ ...SAISON, team_id: TeamsReplaceSaisonTeamParams.shape.team_id }),
  run: async ({ saison_id, team_id, incoming_team_id }) => {
    await teamsReplaceSaisonTeam(team_id, saison_id, { incoming_team_id });
    return { ok: true, value: undefined };
  },
});

/**
 * Mails every admitted team of the season a fresh registration link, passing over each team the editor's link rows
 * mark as skipped: one gone, one no confirmed address reaches, and one whose live link was already sent.
 */
export const sendInvitations = action({
  lane: "admin",
  name: "sendInvitations",
  input: OfSaison,
  run: async ({ saison_id }) => {
    const { mailed } = await saisonsPostInvitationsMail(saison_id);
    // The teams the press owed a mail to, which the rows then show as sent.
    return { ok: true, value: undefined, note: ADMIN_COPY.saison.sentTo(mailed) };
  },
});
