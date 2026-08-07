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

// ── The write path ───────────────────────────────────────────────────────────────────────────────────

/**
 * The fields both write payloads carry. German messages: these bind the matchday form's inputs
 * directly, judged in the browser with the schema the action parses (ADR-0050).
 *
 * **`order_val` is the field this form exists to get right.** The bracket and every ordered listing
 * read it, not `beginn` — matchdays routinely share dates — and nothing in the database or the API
 * stops two matchdays of one season holding the same value, which is why the list marks a collision
 * rather than trusting it cannot happen.
 */
const spieltagPayloadFields = {
  name: z.string().nonempty({ error: "Der Spieltag braucht einen Namen." }),
  beginn: CustomDateStringSchema,
  ende: CustomDateStringSchema,
  anzahl_spiele: z.int().positive({ error: "Ein Spieltag umfasst mindestens 1 Spiel." }),
  order_val: z.int().nonnegative({ error: "Die Reihenfolge beginnt bei 0." }),
  saison_phase: FLSaisonPhaseSchema,
};

export const FLPostSpieltagPayloadSchema = z.object({
  ...spieltagPayloadFields,
  // On the create only. Moving a matchday between seasons is deliberately impossible afterwards: its
  // matches carry their own `saison_id` and this write does not rewrite them.
  saison_id: z.string().length(4, { error: "Bitte wähle eine Saison." }),
});
export type FLPostSpieltagPayload = z.infer<typeof FLPostSpieltagPayloadSchema>;

export const FLPatchSpieltagPayloadSchema = z.object({
  // In the PATH on the wire; carried here because the form has to know which matchday it is saving.
  id: CustomObjectIdStringSchema,
  ...spieltagPayloadFields,
});
export type FLPatchSpieltagPayload = z.infer<typeof FLPatchSpieltagPayloadSchema>;

/** The retire and reactivate calls: an id in the path, no request body. */
export const FLSpieltagKeyPayloadSchema = z.object({
  id: CustomObjectIdStringSchema,
});
export type FLSpieltagKeyPayload = z.infer<typeof FLSpieltagKeyPayloadSchema>;

/**
 * What all four writes echo. `updated_document` is nullable rather than optional: the create answers
 * with the id alone, and every other write echoes the whole document.
 */
export const FLSpieltagWriteResponseSchema = BaseAPIResponseSchema.extend({
  spieltag_id: CustomObjectIdStringSchema,
  updated_document: FLSpieltagSchema.nullable(),
});
export type FLSpieltagWriteResponse = z.infer<typeof FLSpieltagWriteResponseSchema>;
