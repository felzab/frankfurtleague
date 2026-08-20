import z from "zod";

import { BaseAPIResponseSchema } from "@/core/schemas";
import { CustomDateStringSchema, CustomObjectIdStringSchema, PersonNameSchema } from "@/shared/schemas";

/**
 * Mirrors `FLSpielerPosition`. German error because the squad editor's picker binds this directly;
 * an untouched picker submits null, which this refuses and the nullable wrappers below allow.
 */
export const FLSpielerPositionSchema = z.enum(["Tor", "Abwehr", "Mittelfeld", "Angriff"], { error: "Bitte wähle eine Position." });
export type FLSpielerPosition = z.infer<typeof FLSpielerPositionSchema>;

/** Mirrors `FLSpielerStufe` — the Hessen Oberstufe, both phases. */
export const FLSpielerStufeSchema = z.enum(["E1", "E2", "Q1", "Q2", "Q3", "Q4"], { error: "Bitte wähle eine Stufe." });
export type FLSpielerStufe = z.infer<typeof FLSpielerStufeSchema>;

/**
 * Mirrors `FLEinwilligung` — what may be published about this person.
 *
 * `bestandsuebernahme` marks a backfilled record, which must stay distinguishable from consent
 * somebody actually gave. A null `bestaetigt_am` is UNCONFIRMED.
 */
export const FLEinwilligungSchema = z.object({
  umfang: z.enum(["kader_oeffentlich", "intern"]),
  erteilt_von: z.enum(["erziehungsberechtigt", "volljaehrig", "bestandsuebernahme"]),
  datum: CustomDateStringSchema.nullable(),
  bestaetigt_am: CustomDateStringSchema.nullable(),
});
export type FLEinwilligung = z.infer<typeof FLEinwilligungSchema>;

// Mirrors the backend `FLSpieler`, and must be exactly as nullable as it is: a null on a field
// declared non-nullable throws `APIMalformedDataError` on an otherwise valid response.
export const FLSpielerSchema = z.object({
  id: CustomObjectIdStringSchema,
  vorname: z.string(),
  nachname: z.string().nullable(),
  einwilligung: FLEinwilligungSchema,
  stufe: FLSpielerStufeSchema.nullable(),
  nummer: z.string().nullable(),
  position: FLSpielerPositionSchema.nullable(),
  is_nachgetragen: z.boolean(),
  is_captain: z.boolean(),
  team_id: CustomObjectIdStringSchema,
  // Declared because the backend sends it: zod's default strip mode discards an undeclared field
  // with no error.
  inactive_since: CustomDateStringSchema.nullable(),
});
export type FLSpieler = z.infer<typeof FLSpielerSchema>;

export const FLSpielerListResponseSchema = BaseAPIResponseSchema.extend({
  spieler: z.array(FLSpielerSchema),
});
export type FLSpielerListResponse = z.infer<typeof FLSpielerListResponseSchema>;

/**
 * Mirrors `FLSpielerMembership`. Carries `inactive_since`, unlike the team junction: a squad row
 * really is retired when a player leaves mid-season, while a team never leaves a season.
 */
export const FLSpielerMembershipSchema = z.object({
  saison_id: z.string(),
  team_id: CustomObjectIdStringSchema,
  nummer: z.string().nullable(),
  position: FLSpielerPositionSchema.nullable(),
  stufe: FLSpielerStufeSchema.nullable(),
  is_nachgetragen: z.boolean(),
  is_captain: z.boolean(),
  inactive_since: CustomDateStringSchema.nullable(),
});
export type FLSpielerMembership = z.infer<typeof FLSpielerMembershipSchema>;

/**
 * Mirrors `FLSpielerWithMemberships`. A different question from `FLSpieler`, not a projection of it:
 * that shape flattens against one season, so it can report neither a player in two nor one in none.
 */
export const FLSpielerWithMembershipsSchema = z.object({
  id: CustomObjectIdStringSchema,
  vorname: z.string().nonempty(),
  nachname: z.string().nullable(),
  // The day the PERSON left the league; a squad row's own retirement is on the membership.
  inactive_since: CustomDateStringSchema.nullable(),
  memberships: z.array(FLSpielerMembershipSchema),
});
export type FLSpielerWithMemberships = z.infer<typeof FLSpielerWithMembershipsSchema>;

export const FLSpielerMembershipsResponseSchema = BaseAPIResponseSchema.extend({
  spieler: z.array(FLSpielerWithMembershipsSchema),
});
export type FLSpielerMembershipsResponse = z.infer<typeof FLSpielerMembershipsResponseSchema>;

/**
 * Shared by create and patch: the patch replaces them wholesale, so both carry the same field set.
 *
 * No uniqueness rule on a name — two people genuinely can share one.
 */
const spielerPayloadFields = {
  vorname: PersonNameSchema,
  // The form submits null for an empty box, never an empty string — a surname often arrives later.
  nachname: PersonNameSchema.nullable(),
};

// OPTIONAL on the create and required on the patch, mirroring the backend: a create has nothing to
// overwrite, while a patch replaces wholesale and an omitted field would erase a stored surname.
export const FLPostSpielerPayloadSchema = z.object({
  ...spielerPayloadFields,
  nachname: spielerPayloadFields.nachname.optional(),
});
export type FLPostSpielerPayload = z.infer<typeof FLPostSpielerPayloadSchema>;

export const FLPatchSpielerPayloadSchema = z.object({
  id: CustomObjectIdStringSchema,
  ...spielerPayloadFields,
});
export type FLPatchSpielerPayload = z.infer<typeof FLPatchSpielerPayloadSchema>;

export const FLDeleteSpielerPayloadSchema = z.object({
  id: CustomObjectIdStringSchema,
});
export type FLDeleteSpielerPayload = z.infer<typeof FLDeleteSpielerPayloadSchema>;

export const FLReactivateSpielerPayloadSchema = z.object({
  id: CustomObjectIdStringSchema,
});
export type FLReactivateSpielerPayload = z.infer<typeof FLReactivateSpielerPayloadSchema>;

/**
 * No transforms — empty-to-null normalisation is the FORM boundary's. A schema that rewrote its
 * input would make `z.infer` disagree with what the form holds, and `apiContract.test.ts` compares
 * this shape to the published document.
 */
const saisonSpielerPayloadFields = {
  team_id: CustomObjectIdStringSchema,
  // A string on the wire — worn rather than counted — but free text was never meant to admit a name.
  nummer: z
    .string()
    .regex(/^\d{1,4}$/, { error: "Die Nummer besteht aus 1 bis 4 Ziffern." })
    .nullable(),
  position: FLSpielerPositionSchema.nullable(),
  stufe: FLSpielerStufeSchema.nullable(),
  // The create form derives this from the season's status rather than asking it, so it cannot be
  // forgotten.
  is_nachgetragen: z.boolean(),
  // On the junction: captaincy is a role within one team for one season, not a property of the person.
  is_captain: z.boolean(),
};

export const FLPostSaisonSpielerPayloadSchema = z.object({
  // In the PATH on the wire; carried here because the form has to know which player it is entering.
  spieler_id: CustomObjectIdStringSchema,
  saison_id: z.string().length(4, { error: "Bitte wähle eine Saison." }),
  ...saisonSpielerPayloadFields,
});
export type FLPostSaisonSpielerPayload = z.infer<typeof FLPostSaisonSpielerPayloadSchema>;

export const FLPatchSaisonSpielerPayloadSchema = z.object({
  // Both ids are in the PATH on the wire — the junction row is addressed by its natural key.
  spieler_id: CustomObjectIdStringSchema,
  saison_id: z.string().length(4),
  ...saisonSpielerPayloadFields,
});
export type FLPatchSaisonSpielerPayload = z.infer<typeof FLPatchSaisonSpielerPayloadSchema>;

/** The junction row's natural key, for the two endpoints that carry no body. */
export const FLSaisonSpielerKeyPayloadSchema = z.object({
  spieler_id: CustomObjectIdStringSchema,
  saison_id: z.string().length(4),
});
export type FLSaisonSpielerKeyPayload = z.infer<typeof FLSaisonSpielerKeyPayloadSchema>;

/**
 * One form, split by the action into two requests. One form on purpose: every squad read joins the
 * junction strictly (backend spec I33), so a player created without a row is invisible to every
 * surface that could give them one.
 */
export const FLCreateSpielerFormPayloadSchema = z.object({
  ...spielerPayloadFields,
  // Required here and nullable everywhere else: imported squads hold surnameless rows, but a player
  // entered through this form always has one.
  nachname: PersonNameSchema,
  saison_id: z.string().length(4, { error: "Bitte wähle eine Saison." }),
  ...saisonSpielerPayloadFields,
});
export type FLCreateSpielerFormPayload = z.infer<typeof FLCreateSpielerFormPayloadSchema>;

/**
 * Mirrors `FLSpielerSingleResponse` — the person, and only the person: team, number, position and
 * stufe are season-scoped, so a player addressed without a season has none of them.
 */
export const FLSpielerSingleResponseSchema = BaseAPIResponseSchema.extend({
  spieler_id: CustomObjectIdStringSchema,
  vorname: z.string().nonempty(),
  nachname: z.string().nullable(),
  inactive_since: CustomDateStringSchema.nullable(),
});
export type FLSpielerSingleResponse = z.infer<typeof FLSpielerSingleResponseSchema>;

export const FLSpielerWriteResponseSchema = BaseAPIResponseSchema.extend({
  spieler_id: CustomObjectIdStringSchema,
});
export type FLSpielerWriteResponse = z.infer<typeof FLSpielerWriteResponseSchema>;

/** A junction row, echoed as it was written — it has no read model of its own. */
export const FLSaisonSpielerResponseSchema = BaseAPIResponseSchema.extend({
  spieler_id: CustomObjectIdStringSchema,
  saison_id: z.string(),
  team_id: CustomObjectIdStringSchema,
  nummer: z.string().nullable(),
  position: FLSpielerPositionSchema.nullable(),
  stufe: FLSpielerStufeSchema.nullable(),
  is_nachgetragen: z.boolean(),
  is_captain: z.boolean(),
  inactive_since: CustomDateStringSchema.nullable(),
});
export type FLSaisonSpielerResponse = z.infer<typeof FLSaisonSpielerResponseSchema>;
