"use server";

import { z } from "zod";

import { action, PAGE_HOLDER } from "@/core/action";
import { COPY } from "@/core/copy";
import {
  saisonsActivateSaison,
  saisonsDeleteSpielplan,
  saisonsPostInvitationsDispatch,
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

/** An act naming its season alone. */
const OfSaison = z.object(SAISON);

/** An act on the passkey touch's list, naming its season and the address its page was drawn for. */
const TouchedOfSaison = z.object({ ...SAISON, ...PAGE_HOLDER });

/**
 * What a draw and its regeneration word: the stored rules' shape, and the clubs entered short of or past it. The
 * editor closes both acts on the read's own judgement of the groups, so a press meets that refusal only where clubs
 * moved after the page was read.
 */
const DRAW_WORDS = ["rules_bracket_impossible", "rules_spiele_over_one_read", "spielplan_gruppen_off_rules", "saison_past"] as const;

/** Draws the season's Spielplan from its stored rules, a first draw, which the undraw takes back whole. */
export const drawSpielplan = action({
  lane: "admin",
  name: "drawSpielplan",
  input: OfSaison,
  ownWords: DRAW_WORDS,
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
  ownWords: DRAW_WORDS,
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
  ownWords: ["saison_past"],
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
  ownWords: ["activate_target_undrawn", "activate_saison_unfinished", "activate_spieltage_undated", "saison_past"],
  run: async ({ saison_id }) => {
    await saisonsActivateSaison(saison_id);
    return { ok: true, value: undefined };
  },
});

/**
 * Exchanges two clubs' groups, every group match of either rewritten in the same write. The editor's pickers close
 * every pair a match of which has taken place, so `swap_sides_taken_place` meets only a match played after the read.
 */
export const swapGruppen = action({
  lane: "admin",
  name: "swapGruppen",
  input: SaisonsSwapGruppenBody.extend(SAISON),
  ownWords: ["swap_sides_taken_place", "saison_past"],
  run: async ({ saison_id, ...pair }) => {
    await saisonsSwapGruppen(saison_id, pair);
    return { ok: true, value: undefined };
  },
});

/**
 * Hands a club's row of the season, and its whole schedule, to a club the season does not hold. The editor's picker
 * closes every club a match of which has taken place, so `replace_sides_taken_place` meets only one played after the
 * read.
 */
export const replaceTeam = action({
  lane: "admin",
  name: "replaceTeam",
  input: TeamsReplaceSaisonTeamBody.extend({ ...SAISON, team_id: TeamsReplaceSaisonTeamParams.shape.team_id }),
  ownWords: ["replace_sides_taken_place", "saison_past"],
  run: async ({ saison_id, team_id, incoming_team_id }) => {
    await teamsReplaceSaisonTeam(team_id, saison_id, { incoming_team_id });
    return { ok: true, value: undefined };
  },
});

/**
 * Mails every admitted team of the season a fresh registration link, passing over each team the editor's link rows
 * mark as skipped: one gone, one no confirmed address reaches, and one whose live link was already sent.
 */
export const sendRegistrierungslinks = action({
  lane: "admin",
  name: "sendRegistrierungslinks",
  input: OfSaison,
  ownWords: ["saison_past"],
  run: async ({ saison_id }) => {
    const { rows } = await saisonsPostInvitationsDispatch(saison_id, { resend: false });
    // The teams the press owed a mail to, which the rows then show as sent.
    return { ok: true, value: undefined, note: COPY.admin.saison.sentTo(rows.filter((row) => row.recipient.length > 0).length) };
  },
});
