"use server";

import { z } from "zod";

import { action } from "@/core/action";
import { spielorteDeleteSpielort, spielorteReactivateSpielort } from "@/core/generated/client/sdk";
import { SpielorteDeleteSpielortParams, SpielorteReactivateSpielortParams } from "@/core/generated/zod/inputs";

/**
 * Retires the venue from its editor's danger box: it stays on the matches already played there, and no new match is
 * booked there. A venue still booked for a match to come is refused, the sentence naming those matches by their
 * numbers from the refusal's bounds, so the confirmation stays open saying which to move first.
 */
export const retireSpielort = action({
  lane: "admin",
  name: "retireSpielort",
  input: z.object({ id: SpielorteDeleteSpielortParams.shape.spielort_id }),
  ownWords: ["spielort_still_booked"],
  run: async ({ id }) => {
    await spielorteDeleteSpielort(id);
    return { ok: true, value: undefined };
  },
});

/** Brings a retired venue back into every match's choice, from its editor's danger box. */
export const reactivateSpielort = action({
  lane: "admin",
  name: "reactivateSpielort",
  input: z.object({ id: SpielorteReactivateSpielortParams.shape.spielort_id }),
  run: async ({ id }) => {
    await spielorteReactivateSpielort(id);
    return { ok: true, value: undefined };
  },
});
