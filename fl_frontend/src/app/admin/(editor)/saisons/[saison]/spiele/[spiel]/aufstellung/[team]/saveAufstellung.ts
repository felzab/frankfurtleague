"use server";

import { z } from "zod";

import { action } from "@/core/action";
import { COPY } from "@/core/copy/shared";
import { aufstellungenPutAufstellung } from "@/core/generated/client/sdk";
import { AufstellungenPutAufstellungBody, AufstellungenPutAufstellungParams } from "@/core/generated/zod/inputs";
import { entriesOf, refusedRows } from "@/features/aufstellungen/payload";
import { getAufstellung } from "@/features/aufstellungen/queries";

import type { LaneAnswer } from "@/core/action";

// A pupil's id: the editor names pupils alone, and the stored entries naming nobody go back as stored.
const ids = AufstellungenPutAufstellungBody.shape.spieler.element.shape.spieler_id.options[0];

/** What the line-up's editor sends: the club whose line-up it is, the fixture, and the half it changed. */
const SaveAufstellung = z.object({
  team_id: AufstellungenPutAufstellungParams.shape.team_id,
  id: AufstellungenPutAufstellungParams.shape.spiel_id,
  version: AufstellungenPutAufstellungBody.shape.version,
  changes: z.object({ picked: z.array(ids).readonly(), starters: z.array(ids).readonly() }).partial(),
});

/**
 * Saves a club's line-up for one fixture as the league, on the version the editor was read at, answering the version
 * stored. The clock locks nothing here: the league enters a line-up before the team's lock and after it alike. The
 * write takes the line-up whole, so the half the editor left alone is sent as it is stored, read again here; a line-up
 * someone saved since is refused as stale (`version_stale`) rather than written over.
 */
export const saveAufstellung = action({
  lane: "admin",
  name: "saveAdminAufstellung",
  input: SaveAufstellung,
  run: async ({ team_id, id, version, changes }): Promise<LaneAnswer<number>> => {
    const stored = await getAufstellung(id, team_id);
    if (stored === null) return { ok: false, reason: COPY.shared.failure.stale };

    const spieler = entriesOf(stored, changes);
    let written;
    try {
      written = await aufstellungenPutAufstellung(id, team_id, { spieler, version });
    } catch (error) {
      // A pupil refused by entry is marked on their row; every other refusal the action words.
      const rows = refusedRows(error, spieler);
      if (rows === undefined) throw error;
      return rows;
    }
    return { ok: true, value: written.version };
  },
});
