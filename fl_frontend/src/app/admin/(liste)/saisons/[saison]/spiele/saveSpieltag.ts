"use server";

import { z } from "zod";

import { action } from "@/core/action";
import { spieltagePatchSpieltag } from "@/core/generated/client/sdk";
import { SpieltagePatchSpieltagBody, SpieltagePatchSpieltagParams } from "@/core/generated/zod/inputs";

const { shape } = SpieltagePatchSpieltagBody;

/** The matchday dialog's two dates, on the matchday and the version the list read it at. */
const SaveSpieltag = z.object({
  id: SpieltagePatchSpieltagParams.shape.spieltag_id,
  // Required here though the write still takes a save without one: the list always read the matchday's version.
  version: z.int(),
  beginn: shape.beginn,
  ende: shape.ende,
});

/**
 * Re-dates one matchday from the Spiele list's dialog. The version sent is the one the list read: a matchday re-dated
 * since is refused as stale (`version_stale`) rather than written over.
 */
export const saveSpieltag = action({
  lane: "admin",
  name: "saveSpieltag",
  input: SaveSpieltag,
  ownWords: ["spieltag_ends_before_start", "spieltag_outside_saison", "spieltag_span_below_spiele", "spieltag_beginn_out_of_order"],
  // The span's own rule names the end it refuses, as the dialog's own check does before the send.
  paths: { ende: "ende" },
  run: async ({ id, version, beginn, ende }) => {
    await spieltagePatchSpieltag(id, { beginn, ende, version });
    return { ok: true, value: undefined };
  },
});
