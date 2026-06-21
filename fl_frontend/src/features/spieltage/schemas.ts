import { CustomDateStringSchema, CustomObjectIdStringSchema } from "@/shared/schemas";
import z from "zod";

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
});
export type FLSpieltag = z.infer<typeof FLSpieltagSchema>;

export const FLSpieltagWithSpieleSchema = FLSpieltagSchema.extend({ spiele: z.array(FLSpielSchema) });
export type FLSpieltagWithSpiele = z.infer<typeof FLSpieltagWithSpieleSchema>;

export const FLSpielplanSchema = z.object({
  spieltage: z.array(FLSpieltagWithSpieleSchema),
});
export type FLSpielplan = z.infer<typeof FLSpielplanSchema>;

export const FLSpieltageListResponseSchema = z.object({
  spieltage: z.array(FLSpieltagSchema),
});
export type FLSpieltageListResponse = z.infer<typeof FLSpieltageListResponseSchema>;
