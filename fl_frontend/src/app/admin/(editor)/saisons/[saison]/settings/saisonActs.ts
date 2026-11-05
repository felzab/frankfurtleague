"use server";

import { z } from "zod";

import { action, PAGE_HOLDER } from "@/core/action";
import { COPY } from "@/core/copy";
import { APIBadStatusError } from "@/core/errors";
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
import { SERVER_COPY } from "@/core/serverCopy";

import type { ActionAnswer } from "@/core/action";
import type { Copy } from "@/core/copy";

const SAISON = { saison_id: SaisonsSwapGruppenParams.shape.saison_id };

/** An act naming its season alone. */
const OfSaison = z.object(SAISON);

/** An act on the passkey touch's list, naming its season and the address its page was drawn for. */
const TouchedOfSaison = z.object({ ...SAISON, ...PAGE_HOLDER });

/**
 * The swap's and the replacement's refusal of a fixture that has taken place, `swap_sides_taken_place` and
 * `replace_sides_taken_place`, worded for the act that met it. The editor's pickers close every pair and row it
 * refuses, so it is met only where a match took place after the page was read.
 */
async function sidesWorded(write: () => Promise<unknown>, sentence: Copy): Promise<ActionAnswer> {
  try {
    await write();
  } catch (error) {
    if (
      error instanceof APIBadStatusError &&
      (error.serverErrorCode === "swap_sides_taken_place" || error.serverErrorCode === "replace_sides_taken_place")
    ) {
      return { ok: false, errorCode: error.serverErrorCode, reason: sentence };
    }
    throw error;
  }
  return { ok: true, value: undefined };
}

/** Draws the season's Spielplan from its stored rules, a first draw, which the undraw takes back whole. */
export const drawSpielplan = action({
  lane: "admin",
  name: "drawSpielplan",
  input: OfSaison,
  ownWords: ["rules_bracket_impossible", "rules_spiele_over_one_read", "saison_past"],
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
  ownWords: ["rules_bracket_impossible", "rules_spiele_over_one_read", "saison_past"],
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

/** Exchanges two clubs' groups, every group match of either rewritten in the same write. */
export const swapGruppen = action({
  lane: "admin",
  name: "swapGruppen",
  input: SaisonsSwapGruppenBody.extend(SAISON),
  ownWords: ["saison_past"],
  run: async ({ saison_id, ...pair }) => sidesWorded(() => saisonsSwapGruppen(saison_id, pair), SERVER_COPY.admin.swapSidesTakenPlace),
});

/** Hands a club's row of the season, and its whole schedule, to a club the season does not hold. */
export const replaceTeam = action({
  lane: "admin",
  name: "replaceTeam",
  input: TeamsReplaceSaisonTeamBody.extend({ ...SAISON, team_id: TeamsReplaceSaisonTeamParams.shape.team_id }),
  ownWords: ["saison_past"],
  run: async ({ saison_id, team_id, incoming_team_id }) =>
    sidesWorded(() => teamsReplaceSaisonTeam(team_id, saison_id, { incoming_team_id }), SERVER_COPY.admin.replacementSidesTakenPlace),
});

/** Mails every admitted team of the season a fresh registration link, passing over those the preview passes over. */
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
