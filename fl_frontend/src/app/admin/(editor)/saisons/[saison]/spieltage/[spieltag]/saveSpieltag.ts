"use server";

import { z } from "zod";

import { action } from "@/core/action";
import { COPY } from "@/core/copy";
import { spieltagePatchSpieltag } from "@/core/generated/client/sdk";
import { SpieltagePatchSpieltagBody, SpieltagePatchSpieltagParams } from "@/core/generated/zod/inputs";
import { getAdminSpieltag } from "@/features/spieltage/queries";

import { valuesOf } from "./spieltagValues";

import type { ActionAnswer } from "@/core/action";

const { shape } = SpieltagePatchSpieltagBody;

/** What the editor's two boxes send, each held to the matchday write's own published rule for it. */
const SaveSpieltag = z.object({
  id: SpieltagePatchSpieltagParams.shape.spieltag_id,
  // The matchday's version as the editor read it.
  version: shape.version,
  // A box emptied sends no day, which the write cannot take: refused below on its box.
  changes: z.object({ start: z.union([shape.start, z.null()]), end: z.union([shape.end, z.null()]) }).partial(),
});

/**
 * Saves the matchday editor's dates on the version the editor was read at, answering the version stored, which the
 * editor takes as its own. The write takes both dates, so a date left alone is sent as it is stored, read again here;
 * a matchday re-dated since is refused as stale (`version_stale`) rather than written over.
 */
export const saveSpieltag = action({
  lane: "admin",
  name: "saveSpieltag",
  input: SaveSpieltag,
  ownWords: [
    "spieltag_ends_before_start",
    "spieltag_outside_saison",
    "spieltag_span_below_spiele",
    "spieltag_start_out_of_order",
    // The editor opened before its season finished: the write refuses a finished season's matchday whole.
    "saison_past",
  ],
  // The span's own rule names the end it refuses, as the box's own check does before the send.
  paths: { end: "changes.end" },
  run: async ({ id, version, changes }): Promise<ActionAnswer<number>> => {
    const stored = await getAdminSpieltag(id);
    if (stored === null) return { ok: false, reason: COPY.shared.failure.stale };

    const { start, end } = { ...valuesOf(stored.spieltag), ...changes };
    // A day emptied, or one the matchday never held and the editor left empty, which the write cannot take.
    const required = COPY.shared.field.required;
    if (start === null || end === null) {
      return {
        ok: false,
        fieldErrors: { ...(start === null ? { "changes.start": required } : {}), ...(end === null ? { "changes.end": required } : {}) },
      };
    }
    const written = await spieltagePatchSpieltag(id, { start, end, version });
    return { ok: true, value: written.version };
  },
});
