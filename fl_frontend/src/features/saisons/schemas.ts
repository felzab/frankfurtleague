import z from "zod";

import { BaseAPIResponseSchema } from "@/core/schemas";
import { CustomDateStringSchema } from "@/shared/schemas";

export const FLSaisonStatusSchema = z.enum(["past", "active", "future"], { error: "FLSaisonStatus is invalid" });
export const FLSaisonPhaseSchema = z.enum(["gruppenphase", "viertelfinale", "halbfinale", "finale"], { error: "FLSaisonPhase is invalid" });
export type FLSaisonPhase = z.infer<typeof FLSaisonPhaseSchema>;

export const FLSaisonsSortOptionsSchema = z.enum(["_id", "start_date", "end_date"], { error: "FLSaisonsSortOptions is invalid" });

export const FLSaisonRulesSchema = z.object({
  win_points: z.int().positive(),
  draw_points: z.int().nonnegative(),
});

export const FLSaisonSchema = z.object({
  id: z.string(),

  start_date: CustomDateStringSchema,
  end_date: CustomDateStringSchema,
  status: FLSaisonStatusSchema,
  rules: FLSaisonRulesSchema,
});
export type FLSaison = z.infer<typeof FLSaisonSchema>;

export const FLSaisonListResponseSchema = BaseAPIResponseSchema.extend({
  format: z.literal("list"),
  saisons: z.array(FLSaisonSchema),
});
export type FLSaisonListResponse = z.infer<typeof FLSaisonListResponseSchema>;

export const FLSaisonsSingleResponseSchema = BaseAPIResponseSchema.extend({
  format: z.literal("single"),
  saison: FLSaisonSchema,
});
export type FLSaisonsSingleResponse = z.infer<typeof FLSaisonsSingleResponseSchema>;

export const FLSaisonsResponseSchema = z.discriminatedUnion("format", [FLSaisonListResponseSchema, FLSaisonsSingleResponseSchema]);
export type FLSaisonsResponse = z.infer<typeof FLSaisonsResponseSchema>;
