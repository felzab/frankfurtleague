"use server";

import { z } from "zod";

import { action } from "@/core/action";
import { COPY } from "@/core/copy";
import { ContractBreakError } from "@/core/errors";
import { aufstellungenPutAufstellungSelf } from "@/core/generated/client/sdk";
import {
  AufstellungenPutAufstellungSelfBody,
  AufstellungenPutAufstellungSelfParams,
  TeamsGetTeamSpieleParams,
} from "@/core/generated/zod/inputs";
import { entriesOf } from "@/features/aufstellungen/payload";
import { getAufstellungSelf } from "@/features/aufstellungen/queries";

import type { ActionAnswer } from "@/core/action";

const ids = AufstellungenPutAufstellungSelfBody.shape.spieler.element.shape.spieler_id;

/** What the line-up's editor sends: the club and the season its seat is claimed at, the fixture, and the half it changed. */
const SaveAufstellung = z.object({
  team_id: AufstellungenPutAufstellungSelfParams.shape.team_id,
  saison_id: TeamsGetTeamSpieleParams.shape.saison_id,
  // The fixture, the editor's record.
  id: AufstellungenPutAufstellungSelfParams.shape.spiel_id,
  version: AufstellungenPutAufstellungSelfBody.shape.version,
  changes: z.object({ picked: z.array(ids).readonly(), starters: z.array(ids).readonly() }).partial(),
});

/**
 * Saves a club's line-up for one fixture as a seat of the club, on the version the editor was read at, answering the
 * version stored. The write takes the line-up whole, so the half the editor left alone is sent as it is stored, read
 * again here; a line-up someone saved since is refused as stale (`version_stale`) rather than written over.
 */
export const saveAufstellung = action({
  lane: "person",
  claim: "seat",
  name: "saveAufstellung",
  input: SaveAufstellung,
  ownWords: [
    // The page was open before the lock, the fixture lost its day or hour, or a nominee stands beside eleven others,
    // which the block marks on the nominee's row and leaves the person to take out.
    "aufstellung_locked",
    "aufstellung_spiel_undated",
    "aufstellung_nominee_without_shortage",
  ],
  run: async ({ team_id, id, version, changes }): Promise<ActionAnswer<number>> => {
    const stored = await getAufstellungSelf(id, team_id);
    if (stored === null) return { ok: false, reason: COPY.shared.failure.stale };

    const written = await aufstellungenPutAufstellungSelf(id, team_id, { spieler: entriesOf(stored, changes), version });
    if (written.version === null) throw new ContractBreakError("A line-up's save answered no version.");
    return { ok: true, value: written.version };
  },
});
