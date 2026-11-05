"use server";

import { z } from "zod";

import { action } from "@/core/action";
import { saisonsPostSaison } from "@/core/generated/client/sdk";
import { SaisonsPostSaisonBody } from "@/core/generated/zod/inputs";

const { shape } = SaisonsPostSaisonBody;

/** The create dialog's boxes, by the names they post under, each held to the create's own published rule. */
const CreateSaisonForm = z.object({
  start_date: shape.start_date,
  end_date: shape.end_date,
});

/**
 * Creates the next season, always planned, from the create dialog's dates; the backend names it, carries on the newest
 * season's rules and starts its windows closed, each set in the season's own editor.
 */
export const createSaison = action({
  lane: "admin",
  name: "createSaison",
  input: CreateSaisonForm,
  ownWords: ["saison_ends_before_start", "saison_span_below_spielplan", "rules_bracket_impossible"],
  paths: { start_date: "start_date", end_date: "end_date" },
  run: async (form) => {
    await saisonsPostSaison(form);
    return { ok: true, value: undefined };
  },
});
