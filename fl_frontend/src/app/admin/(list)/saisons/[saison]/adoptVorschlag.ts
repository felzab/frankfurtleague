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
 * Übersicht's row once its question has named the move and its mails. The save's refusals arrive with no path, the
 * adoption posting no body, so a code the save words by its path arrives under a twin per resource or side, each
 * worded as the save's sentence for that path.
 */
export const adoptVorschlag = action({
  lane: "admin",
  name: "adoptVorschlag",
  input: z.object({ id: SpielbestaetigungenAdoptSpielbestaetigungParams.shape.spielbestaetigung_id }),
  ownWords: [
    "ansetzung_vorschlag_past_as_stored",
    "spiel_outside_spieltag",
    "spiel_double_booked_spielort_as_stored",
    "spiel_double_booked_schiedsrichter_as_stored",
    "eligibility_disqualified_team1_as_stored",
    "eligibility_disqualified_team2_as_stored",
    "saison_past",
    // The season's bracket stale, its resolution would delete a later result, which the match editor asks about first.
    "voided_results_stale",
  ],
  run: async ({ id }) => {
    await spielbestaetigungenAdoptSpielbestaetigung(id);
    return { ok: true, value: undefined };
  },
});

/**
 * Closes a club's open decline whose proposed date the league will not take: the date stands, and the club is told
 * so.
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
