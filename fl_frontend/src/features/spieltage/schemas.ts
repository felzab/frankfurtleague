/**
 * SPIELTAGE · models
 *
 * Mirrors `fl_backend/app/api/spieltage/schemas.py`.
 *
 * **A matchday carries no position and no field here holds one** (ADR-0064). The order is
 * `saison_phase` in bracket order, then `beginn`, then `name`, applied by the backend before the
 * response is built — so a list arrives in the order it is played and nothing on this side re-sorts it.
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
 * **No position, on either payload** (ADR-0064). Where a matchday sits in its season follows from its
 * phase and its date, so the two fields that decide it are already here and there is no third one to
 * keep in step with them.
 */
const spieltagPayloadFields = {
  name: z.string().nonempty({ error: "Der Spieltag braucht einen Namen." }),
  beginn: CustomDateStringSchema,
  ende: CustomDateStringSchema,
  anzahl_spiele: z.int().positive({ error: "Ein Spieltag umfasst mindestens 1 Spiel." }),
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
