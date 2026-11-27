"use server";

import { z } from "zod";

import { action, fault } from "@/core/action";
import { COPY } from "@/core/copy/shared";
import { spieltagePatchSpieltag } from "@/core/generated/client/sdk";
import { SpieltagePatchSpieltagBody, SpieltagePatchSpieltagParams } from "@/core/generated/zod/inputs";
import { getAdminSpieltag } from "@/features/spieltage/queries";

import { requiredOf, valuesOf } from "./spieltagValues";

import type { LaneAnswer } from "@/core/action";

const { shape } = SpieltagePatchSpieltagBody;

const SaveSpieltag = z.object({
  id: SpieltagePatchSpieltagParams.shape.spieltag_id,
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
  run: async ({ id, version, changes }): Promise<LaneAnswer<number>> => {
    const stored = await getAdminSpieltag(id);
    if (stored === null) return { ok: false, reason: COPY.shared.failure.stale };

    const merged = { ...valuesOf(stored.spieltag), ...changes };
    const { start, end } = merged;
    if (start === null || end === null) return { ok: false, faults: requiredOf(merged).map((box) => fault(`changes.${box}`, "required")) };
    const written = await spieltagePatchSpieltag(id, { start, end, version });
    return { ok: true, value: written.version };
  },
});
