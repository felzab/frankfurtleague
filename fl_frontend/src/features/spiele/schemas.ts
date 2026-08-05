/**
 * SPIELE · models
 *
 * The Zod read model, the admin patch payload composed from it, and the draft types the edit form uses
 * while a field is mid-edit.
 *
 * These are HAND-MIRRORED by `fl_backend/app/api/spiele/schemas.py` in Pydantic. There is no generation
 * step, so a constraint changed there must be changed here in the same commit.
 *
 * `src/core/apiContract.test.ts` compares the two (ADR-0040) on presence, requiredness, nullability,
 * primitive type and enum members. It does NOT compare patterns, lengths or ranges — the German
 * messages and the regexes below are this file's alone, and are the first thing to check when
 * behaviour looks impossible.
 *
 *  INVARIANTS ───────────────────────────────────────────────────────────────────────────────────────────
 *
 *   • The patch payload composes from the read model's field schemas rather than redeclaring them, so
 *     the write shape cannot drift from the read shape.
 *   • Zod's default `strip` mode discards undeclared fields silently. A field the backend sends but
 *     this schema omits is lost with no error — that is how `saison_id` went missing.
 *   • Draft types exist so an emptied currency field is `null` rather than silently `0`. The strict
 *     schemas still reject `null`, so a cleared field fails with a German message on the field.
 *
 *  SEE ALSO ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 *   docs/backend/spec.md — section 3, what PATCH /spiele/{spiel_id} does with this payload
 *   docs/backend/spec.md — invariant I16: no database validator constrains a range, a pattern or a
 *   length, so these schemas and their Pydantic twin are the only place those constraints are stated
 */

import z from "zod";

import { BaseAPIResponseSchema } from "@/core/schemas";
import { CustomDateStringSchema, CustomObjectIdStringSchema, CustomTimeStringSchema } from "@/shared/schemas";

import { FLSaisonPhaseSchema } from "../saisons/schemas";

export const FLSpielStatusSchema = z.enum(["ausstehend", "vergangen", "heute", "abgesagt", "unbekannt"], { error: "FLSpielStatus is invalid" });
export type FLSpielStatus = z.infer<typeof FLSpielStatusSchema>;

export const FLSpielTeamFieldSchema = z.object({
  team_id: CustomObjectIdStringSchema,
  name: z.string(),
  tore: z.int().nonnegative().nullable(),
  shorthand: z.string().length(2),
});
export type FLSpielTeamField = z.infer<typeof FLSpielTeamFieldSchema>;

export const FLSpielOrtFieldSchema = z.object({
  spielort_id: CustomObjectIdStringSchema,
  name: z.string().nonempty(),
  maps_link: z.string().nonempty(),
  // The message goes on the TYPE check, not on `nonnegative()`: the reachable failure is a cleared
  // field arriving as `null`, and every one of these inputs has `minValue={0}`, so a negative number
  // never gets here.
  mietpreis: z.int({ error: "Bitte gib einen Mietpreis ein." }).nonnegative({ error: "Der Mietpreis darf nicht negativ sein." }),
});
export type FLSpielOrtField = z.infer<typeof FLSpielOrtFieldSchema>;

export const FLSpielSchiedsrichterFieldSchema = z.object({
  schiedsrichter_id: CustomObjectIdStringSchema,
  name: z.string().nonempty(),
  payment: z.int({ error: "Bitte gib eine Entschädigung ein." }).nonnegative({ error: "Die Entschädigung darf nicht negativ sein." }),
});
export type FLSpielSchiedsrichterField = z.infer<typeof FLSpielSchiedsrichterFieldSchema>;

/**
 * The edit form's in-progress shapes. An emptied currency field is `null` while the admin is typing
 * — it must not silently become 0, which is what shipped a 0 € Mietpreis whenever someone cleared
 * the box. The strict schemas above still reject `null`, so a cleared
 * field fails validation with the German message on it rather than saving a wrong number.
 */
export type FLSpielOrtFieldDraft = Omit<FLSpielOrtField, "mietpreis"> & { mietpreis: number | null };
export type FLSpielSchiedsrichterFieldDraft = Omit<FLSpielSchiedsrichterField, "payment"> & { payment: number | null };

export const FLSpielSchema = z.object({
  id: CustomObjectIdStringSchema,
  spieltag_id: CustomObjectIdStringSchema,

  team1: FLSpielTeamFieldSchema,
  team2: FLSpielTeamFieldSchema,

  datum: CustomDateStringSchema.nullable(),
  uhrzeit: CustomTimeStringSchema.nullable(),

  ort: FLSpielOrtFieldSchema.nullable(),
  schiedsrichter: FLSpielSchiedsrichterFieldSchema.nullable(),

  // "Tore:Tore". Not free text -- TeamDetailsView splits it on ":" to derive W/D/L, and a
  // malformed "3" silently rendered as a loss for both teams. null means "not played yet".
  ergebnis: z
    .string()
    .regex(/^[0-9]+:[0-9]+$/, "Ergebnis muss die Form 'Tore:Tore' haben, z. B. '3:1'")
    .nullable(),

  spiel_nr: z.int().positive(),
  is_canceled: z.boolean(),
  saison_phase: FLSaisonPhaseSchema,
  // The backend sends this (FLSpiel.saison_id, min_length=4, max_length=4). Until it was declared
  // here, zod's default strip mode discarded it silently -- which is why the admin patch action has
  // no season id to invalidate a granular cache tag with.
  saison_id: z.string().length(4),
});
export type FLSpiel = z.infer<typeof FLSpielSchema>;

export const FLSpieleListResponseSchema = BaseAPIResponseSchema.extend({
  spiele: z.array(FLSpielSchema),
});
export type FLSpieleListResponse = z.infer<typeof FLSpieleListResponseSchema>;

/**
 * The admin edit payload, composed from the field schemas above rather than redeclaring them, so
 * the write shape cannot drift from the read shape. That composition is intra-slice and must stay
 * so: the Spiel write path belongs to this slice, not to `admin` (ADR-0005).
 */
export const FLPatchSpielDataPayloadSchema = z.object({
  datum: CustomDateStringSchema.nullable(),
  uhrzeit: CustomTimeStringSchema.nullable(),

  ort: FLSpielOrtFieldSchema.nullable(),
  schiedsrichter: FLSpielSchiedsrichterFieldSchema.nullable(),

  team1: FLSpielTeamFieldSchema,
  team2: FLSpielTeamFieldSchema,

  spiel_id: CustomObjectIdStringSchema,
  is_canceled: z.boolean(),
});

export type FLPatchSpielDataPayload = z.infer<typeof FLPatchSpielDataPayloadSchema>;
