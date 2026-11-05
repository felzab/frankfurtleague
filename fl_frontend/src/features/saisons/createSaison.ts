"use server";

import { z } from "zod";

import { action } from "@/core/action";
import { saisonsPostSaison } from "@/core/generated/client/sdk";
import { FLSpielerStufe } from "@/core/generated/client/types";
import { SaisonsPostSaisonBody } from "@/core/generated/zod/inputs";

import { getNewestAdminSaison } from "./queries";

import type { FLSaisonRules } from "@/core/generated/client/types";

const { shape } = SaisonsPostSaisonBody;

/** The create dialog's boxes, by the names they post under, each held to the create's own published rule. */
const CreateSaisonForm = z.object({
  id: shape.id,
  start_date: shape.start_date,
  end_date: shape.end_date,
});

/**
 * The rules a league's first season starts from, where no season holds any to carry on. They are the old create
 * form's starting values, which the new season's editor shows at once and keeps editable until its start.
 */
const FIRST_SAISON_RULES: FLSaisonRules = {
  win_points: 3,
  draw_points: 1,
  qualifiers_per_gruppe: 2,
  number_of_gruppen: 2,
  teams_per_gruppe: 5,
  tiebreak_order: "tordifferenz",
  max_kadergroesse: 50,
  forfeit_ergebnis: { sieger_tore: 3, verlierer_tore: 0 },
  allowed_stufen: Object.values(FLSpielerStufe),
};

/**
 * Creates a season, always planned, from the create dialog's year and dates. Its rules carry on from the newest
 * season, the likeliest value, and its windows start closed: each is set in the season's own editor. A year another
 * season holds, or one outside the league's, is refused on the year's box; the dialog stays open with its input kept.
 */
export const createSaison = action({
  lane: "admin",
  name: "createSaison",
  input: CreateSaisonForm,
  ownWords: ["duplicate_key", "saison_year_out_of_range", "saison_ends_before_start", "rules_bracket_impossible"],
  paths: { id: "id", start_date: "start_date", end_date: "end_date" },
  run: async (form) => {
    const newest = await getNewestAdminSaison();
    await saisonsPostSaison({ ...form, rules: newest?.rules ?? FIRST_SAISON_RULES, bewerbung: null, registrierung: null });
    return { ok: true, value: undefined };
  },
});
