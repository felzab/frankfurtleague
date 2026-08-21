import z from "zod";

import { BaseAPIResponseSchema } from "@/core/schemas";
import { CustomDateStringSchema, CustomObjectIdStringSchema } from "@/shared/schemas";

import { FLSaisonPhaseSchema } from "../saisons/schemas";
import { FLSpielSchema } from "../spiele/schemas";

export const FLSpieltagSchema = z.object({
  id: CustomObjectIdStringSchema,

  // Nullable because a matchday arrives without dates: the season's generator writes the round and
  // its place, and a person dates it afterwards. Every reader has to say so rather than format null.
  beginn: CustomDateStringSchema.nullable(),
  ende: CustomDateStringSchema.nullable(),
  // Derived from the season's rules, stored nowhere. Zero is legitimate for a phase the bracket does
  // not reach, hence `nonnegative`.
  anzahl_spiele: z.int().nonnegative(),
  // Stored, unique within one phase of one season, and the ordinal `spieltagLabel` renders — so it
  // starts at one rather than at zero.
  position: z.int().min(1),
  saison_phase: FLSaisonPhaseSchema,
  saison_id: z.string().length(4),
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

export const FLSpieltageSingleResponseSchema = BaseAPIResponseSchema.extend({
  spieltag: FLSpieltagSchema,
});
export type FLSpieltageSingleResponse = z.infer<typeof FLSpieltageSingleResponseSchema>;

// The message names `ende`, the field to fix.
const endsAfterItBegins = {
  error: "Das Ende darf nicht vor dem Beginn liegen.",
  path: ["ende"],
};

/**
 * The dates alone, and **both are required here where the read model holds them nullable**: an
 * undated matchday is one nobody has dated yet, and dating one means supplying the whole span.
 */
export const FLPatchSpieltagPayloadSchema = z
  .object({
    // In the PATH on the wire; here because the form has to know which matchday it is saving.
    id: CustomObjectIdStringSchema,
    beginn: CustomDateStringSchema,
    ende: CustomDateStringSchema,
  })
  .refine((spieltag) => spieltag.ende >= spieltag.beginn, endsAfterItBegins);
export type FLPatchSpieltagPayload = z.infer<typeof FLPatchSpieltagPayloadSchema>;

export const FLSpieltagWriteResponseSchema = BaseAPIResponseSchema.extend({
  spieltag_id: CustomObjectIdStringSchema,
  // Not nullable: the PATCH is the only write left, and it always echoes what it stored.
  updated_document: FLSpieltagSchema,
});
export type FLSpieltagWriteResponse = z.infer<typeof FLSpieltagWriteResponseSchema>;
