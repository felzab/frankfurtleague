/**
 * SAISONS · models
 *
 * Mirrors `fl_backend/app/api/saisons/schemas.py`.
 *
 * `FLSaisonPhaseSchema` lives here rather than in `spiele` because a phase is a property of the
 * season's structure; `spiele` and `spieltage` both import it, so there is one definition and the
 * three cannot drift.
 *
 * Note the phase enum has exactly four values. `"playoffs"` is NOT one of them — it is a query-only
 * alias the backend compiles to "not gruppenphase", and it never appears on a document.
 */

import z from "zod";

import { BaseAPIResponseSchema } from "@/core/schemas";
import { CustomDateStringSchema } from "@/shared/schemas";

export const FLSaisonStatusSchema = z.enum(["past", "active", "future"], { error: "FLSaisonStatus is invalid" });
export const FLSaisonPhaseSchema = z.enum(["gruppenphase", "viertelfinale", "halbfinale", "finale"], { error: "FLSaisonPhase is invalid" });
export type FLSaisonPhase = z.infer<typeof FLSaisonPhaseSchema>;

export const FLSaisonRulesSchema = z.object({
  win_points: z.int().positive(),
  draw_points: z.int().nonnegative(),
});

export const FLSaisonSchema = z.object({
  // Exactly 4, mirroring the backend's FLSaison.id. FLSpielSchema.saison_id and
  // FLSpieltagSchema.saison_id both require .length(4), and resolveSaisonId silently discards a
  // param that is not 4 chars -- so an unbounded id here would let SaisonSelector offer a season
  // that renders as the current one with no error.
  id: z.string().length(4),

  start_date: CustomDateStringSchema,
  end_date: CustomDateStringSchema,
  status: FLSaisonStatusSchema,
  rules: FLSaisonRulesSchema,
});
export type FLSaison = z.infer<typeof FLSaisonSchema>;

export const FLSaisonsListResponseSchema = BaseAPIResponseSchema.extend({
  format: z.literal("list"),
  saisons: z.array(FLSaisonSchema),
});
export type FLSaisonsListResponse = z.infer<typeof FLSaisonsListResponseSchema>;

export const FLSaisonsSingleResponseSchema = BaseAPIResponseSchema.extend({
  format: z.literal("single"),
  saison: FLSaisonSchema,
});
export type FLSaisonsSingleResponse = z.infer<typeof FLSaisonsSingleResponseSchema>;
