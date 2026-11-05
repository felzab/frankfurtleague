"use server";

import { z } from "zod";

import { action } from "@/core/action";
import { spielbestaetigungenAdoptSpielbestaetigung, spielbestaetigungenDiscardSpielbestaetigung } from "@/core/generated/client/sdk";
import {
  SpielbestaetigungenAdoptSpielbestaetigungParams,
  SpielbestaetigungenDiscardSpielbestaetigungParams,
} from "@/core/generated/zod/inputs";

/**
 * Moves the fixture to the date and hour a club's open decline proposes, through the fixture's own save, from the
 * Übersicht's row once its question has named the move and its mails. The save's refusals arrive by their code alone,
 * so a sentence naming the whole write is the most a refusal here can say.
 */
export const adoptVorschlag = action({
  lane: "admin",
  name: "adoptVorschlag",
  input: z.object({ id: SpielbestaetigungenAdoptSpielbestaetigungParams.shape.spielbestaetigung_id }),
  ownWords: ["ansetzung_vorschlag_past", "spiel_outside_spieltag", "booking_unconfirmed_schiedsrichter", "saison_past"],
  run: async ({ id }) => {
    await spielbestaetigungenAdoptSpielbestaetigung(id);
    return { ok: true, value: undefined };
  },
});

/**
 * Closes a club's open decline whose proposed date the league will not take: the date stands, and the club is told
 * so where its day is still to come.
 */
export const discardVorschlag = action({
  lane: "admin",
  name: "discardVorschlag",
  input: z.object({ id: SpielbestaetigungenDiscardSpielbestaetigungParams.shape.spielbestaetigung_id }),
  run: async ({ id }) => {
    await spielbestaetigungenDiscardSpielbestaetigung(id);
    return { ok: true, value: undefined };
  },
});
