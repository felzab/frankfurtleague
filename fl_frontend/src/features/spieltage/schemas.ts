import z from "zod";

import { BaseAPIResponseSchema } from "@/core/schemas";
import { CustomDateStringSchema, CustomObjectIdStringSchema } from "@/shared/schemas";

import { FLSaisonPhaseSchema } from "../saisons/schemas";
import { FLSpielSchema } from "../spiele/schemas";

export const FLSpieltagSchema = z.object({
  id: CustomObjectIdStringSchema,

  beginn: CustomDateStringSchema,
  ende: CustomDateStringSchema,
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

/**
 * The fields both write payloads carry. German messages: these bind the matchday form's inputs
 * directly, judged in the browser with the schema the action parses.
 */
const spieltagPayloadFields = {
  beginn: CustomDateStringSchema,
  ende: CustomDateStringSchema,
  saison_phase: FLSaisonPhaseSchema,
};

// The message names `ende`, the field to fix.
const endsAfterItBegins = {
  error: "Das Ende darf nicht vor dem Beginn liegen.",
  path: ["ende"],
};

export const FLPostSpieltagPayloadSchema = z
  .object({
    ...spieltagPayloadFields,
    // On the create only: its matches carry their own `saison_id` and no write rewrites them.
    saison_id: z.string().length(4, { error: "Bitte wähle eine Saison." }),
  })
  .refine((spieltag) => spieltag.ende >= spieltag.beginn, endsAfterItBegins);
export type FLPostSpieltagPayload = z.infer<typeof FLPostSpieltagPayloadSchema>;

export const FLPatchSpieltagPayloadSchema = z
  .object({
    // In the PATH on the wire; here because the form has to know which matchday it is saving.
    id: CustomObjectIdStringSchema,
    ...spieltagPayloadFields,
    // On the edit only: a create appends to its phase, and the server picks that number. There is no
    // reorder endpoint, so this field is where a matchday moves.
    position: z.int().min(1, { error: "Bitte wähle eine Position." }),
  })
  .refine((spieltag) => spieltag.ende >= spieltag.beginn, endsAfterItBegins);
export type FLPatchSpieltagPayload = z.infer<typeof FLPatchSpieltagPayloadSchema>;

/** `updated_document` is nullable rather than optional: the create answers with the id alone. */
export const FLSpieltagWriteResponseSchema = BaseAPIResponseSchema.extend({
  spieltag_id: CustomObjectIdStringSchema,
  updated_document: FLSpieltagSchema.nullable(),
});
export type FLSpieltagWriteResponse = z.infer<typeof FLSpieltagWriteResponseSchema>;
