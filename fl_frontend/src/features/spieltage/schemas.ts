/**
 * SPIELTAGE · models
 *
 * Mirrors `fl_backend/app/api/spieltage/schemas.py`.
 *
 * **A matchday carries no position and no NAME, and no field here holds either.**
 * The order is `saison_phase` in bracket order, then `beginn`, then `_id`, applied by the backend before
 * the response is built — so a list arrives in the order it is played and nothing on this side re-sorts
 * it. The name a reader sees is composed from that order by `spieltagLabel` in `utils.ts`.
 *
 * **`anzahl_spiele` is on the read shape and on neither payload.** A single round robin per
 * group fixes how many matches a matchday of a given phase holds, so the backend derives it from the
 * season's rules on every read — there is no value here for a form to submit.
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

  beginn: CustomDateStringSchema,
  ende: CustomDateStringSchema,
  // Derived from the season's rules and this matchday's phase, stored nowhere. Zero is
  // legitimate — a phase this season's bracket does not reach expects no matches — so the bound is
  // `nonnegative`, matching `Field(ge=0)` on the backend model.
  anzahl_spiele: z.int().nonnegative(),
  saison_phase: FLSaisonPhaseSchema,
  saison_id: z.string().length(4),
  // The day this matchday was retired, null while it is played. Declared because the
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

/**
 * One matchday addressed by its id — retired ones included, because a caller holding an id was given
 * it by something. `anzahl_spiele` is derived from the addressed matchday's OWN season.
 */
export const FLSpieltageSingleResponseSchema = BaseAPIResponseSchema.extend({
  spieltag: FLSpieltagSchema,
});
export type FLSpieltageSingleResponse = z.infer<typeof FLSpieltageSingleResponseSchema>;

/**
 * The fields both write payloads carry. German messages: these bind the matchday form's inputs
 * directly, judged in the browser with the schema the action parses.
 *
 * **No position, no match count and no name, on either payload.** Where a
 * matchday sits in its season, how many matches it expects and what it is called all follow from its
 * phase, its date and the season's rules — so the fields that decide them are already here, and there is
 * nothing separate to keep in step with them.
 */
const spieltagPayloadFields = {
  beginn: CustomDateStringSchema,
  ende: CustomDateStringSchema,
  saison_phase: FLSaisonPhaseSchema,
};

// Mirrors the model validator on both matchday payloads, and guards the list's order as well as the
// dates: matchdays sort by `beginn` within a phase. The message names `ende`, the field to
// fix.
const endsAfterItBegins = {
  error: "Das Ende darf nicht vor dem Beginn liegen.",
  path: ["ende"],
};

export const FLPostSpieltagPayloadSchema = z
  .object({
    ...spieltagPayloadFields,
    // On the create only. Moving a matchday between seasons is deliberately impossible afterwards: its
    // matches carry their own `saison_id` and this write does not rewrite them.
    saison_id: z.string().length(4, { error: "Bitte wähle eine Saison." }),
  })
  .refine((spieltag) => spieltag.ende >= spieltag.beginn, endsAfterItBegins);
export type FLPostSpieltagPayload = z.infer<typeof FLPostSpieltagPayloadSchema>;

export const FLPatchSpieltagPayloadSchema = z
  .object({
    // In the PATH on the wire; carried here because the form has to know which matchday it is saving.
    id: CustomObjectIdStringSchema,
    ...spieltagPayloadFields,
  })
  .refine((spieltag) => spieltag.ende >= spieltag.beginn, endsAfterItBegins);
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
