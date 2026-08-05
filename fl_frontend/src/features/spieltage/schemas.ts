/**
 * SPIELTAGE · models
 *
 * Mirrors `fl_backend/app/api/spieltage/schemas.py`.
 *
 * `order_val` is the ordering the bracket depends on — not `beginn`. Matchdays routinely share dates.
 *
 * The phase enum is imported from `saisons` and the Spiel model from `spiele` rather than redeclared,
 * so the three cannot drift apart.
 */

import z from "zod";

import { BaseAPIResponseSchema } from "@/core/schemas";
import { CustomDateStringSchema, CustomObjectIdStringSchema } from "@/shared/schemas";

import { FLSaisonPhaseSchema } from "../saisons/schemas";
import { FLSpielSchema } from "../spiele/schemas";

export const FLSpieltagSchema = z.object({
  id: CustomObjectIdStringSchema,

  name: z.string(),
  beginn: CustomDateStringSchema,
  ende: CustomDateStringSchema,
  anzahl_spiele: z.int().positive(),
  order_val: z.int().nonnegative(),
  saison_phase: FLSaisonPhaseSchema,
  saison_id: z.string().length(4),
  // The day this matchday was retired, null while it is played (ADR-0032). Declared because the
  // backend sends it: zod's default strip mode discards an undeclared field with no error.
  inactive_since: CustomDateStringSchema.nullable(),
});
export type FLSpieltag = z.infer<typeof FLSpieltagSchema>;

export const FLSpieltagWithSpieleSchema = FLSpieltagSchema.extend({ spiele: z.array(FLSpielSchema) });
export type FLSpieltagWithSpiele = z.infer<typeof FLSpieltagWithSpieleSchema>;

export const FLSpielplanSchema = z.object({
  spieltage: z.array(FLSpieltagWithSpieleSchema),
});
export type FLSpielplan = z.infer<typeof FLSpielplanSchema>;

export const FLSpieltageListResponseSchema = BaseAPIResponseSchema.extend({
  spieltage: z.array(FLSpieltagSchema),
});
export type FLSpieltageListResponse = z.infer<typeof FLSpieltageListResponseSchema>;
