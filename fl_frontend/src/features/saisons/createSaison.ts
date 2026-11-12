"use server";

import { z } from "zod";

import { action } from "@/core/action";
import { saisonsPostSaison } from "@/core/generated/client/sdk";
import { SaisonsPostSaisonBody } from "@/core/generated/zod/inputs";

const { shape } = SaisonsPostSaisonBody;

const CreateSaisonForm = z.object({
  start_date: shape.start_date,
  end_date: shape.end_date,
});

/**
 * Always planned; the backend names it, carries on the newest season's rules and starts its windows closed, each set in
 * the season's own editor.
 */
export const createSaison = action({
  lane: "admin",
  name: "createSaison",
  input: CreateSaisonForm,
  // A planned season standing, met where another administrator created it after the page was read, the list's act
  // closing on it otherwise; it is the loser's code of two creates at once too.
  ownWords: ["saison_ends_before_start", "saison_span_below_spielplan", "rules_bracket_impossible", "create_saison_future_stands"],
  paths: { start_date: "start_date", end_date: "end_date" },
  run: async (form) => {
    await saisonsPostSaison(form);
    return { ok: true, value: undefined };
  },
});
