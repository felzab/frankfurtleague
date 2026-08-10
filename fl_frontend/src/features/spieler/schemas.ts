/**
 * SPIELER · models
 *
 * Mirrors `fl_backend/app/api/spieler/schemas.py`, no generation step; the contract test checks
 * the wire half (ADR-0033).
 *
 * Invariants:
 * - Only `vorname` is mandatory — the nullability is real: a null once threw on a valid response.
 * - `nummer` is a string and stays free text — worn rather than counted, not unique in a squad.
 * - `position` and `stufe` are closed sets (ADR-0048) — outside values are malformed responses.
 * - `FLSpieler` flattens one season; the admin surfaces read `FLSpielerWithMemberships` (ADR-0027).
 * - The person and the squad row retire independently (ADR-0025).
 */

import z from "zod";

import { BaseAPIResponseSchema } from "@/core/schemas";
import { CustomDateStringSchema, CustomObjectIdStringSchema, PersonNameSchema } from "@/shared/schemas";

/**
 * Mirrors `FLSpielerPosition`. German error because the squad editor's picker binds this schema too,
 * and an untouched picker submits null — which this refuses and the nullable wrappers below allow.
 */
export const FLSpielerPositionSchema = z.enum(["Tor", "Abwehr", "Mittelfeld", "Angriff"], { error: "Bitte wähle eine Position." });
export type FLSpielerPosition = z.infer<typeof FLSpielerPositionSchema>;

/** Mirrors `FLSpielerStufe` — the Hessen Oberstufe, both phases (ADR-0048). */
export const FLSpielerStufeSchema = z.enum(["E1", "E2", "Q1", "Q2", "Q3", "Q4"], { error: "Bitte wähle eine Stufe." });
export type FLSpielerStufe = z.infer<typeof FLSpielerStufeSchema>;

// Mirrors the backend FLSpieler. Only vorname is mandatory; the rest may legitimately be absent for
// a player whose squad entry is unfilled. This mirror must be exactly as nullable as the backend
// model, or a null throws APIMalformedDataError.
export const FLSpielerSchema = z.object({
  id: CustomObjectIdStringSchema,
  vorname: z.string(),
  nachname: z.string().nullable(),
  stufe: FLSpielerStufeSchema.nullable(),
  nummer: z.string().nullable(),
  position: FLSpielerPositionSchema.nullable(),
  is_nachgetragen: z.boolean(),
  is_captain: z.boolean(),
  team_id: CustomObjectIdStringSchema,
  // The day this player left the club, null while they are on a squad (ADR-0025). Declared because
  // the backend sends it: zod's default strip mode discards an undeclared field with no error.
  inactive_since: CustomDateStringSchema.nullable(),
});
export type FLSpieler = z.infer<typeof FLSpielerSchema>;

export const FLSpielerListResponseSchema = BaseAPIResponseSchema.extend({
  spieler: z.array(FLSpielerSchema),
});
export type FLSpielerListResponse = z.infer<typeof FLSpielerListResponseSchema>;

/**
 * Mirrors `FLSpielerMembership` — one squad row as seen from its player.
 *
 * Carries `inactive_since`, which the team junction's equivalent does not: a squad row really is
 * retired when a player leaves a team mid-season, while a team never leaves a season (ADR-0026).
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
 * Mirrors `FLSpielerWithMemberships` — the person as stored, plus every squad row they hold.
 *
 * The admin list's one read, and a different question from `FLSpieler` rather than a projection of
 * it (ADR-0027): that shape is flattened against one season, so it cannot report a player in two and
 * cannot represent a player in none.
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
 * The person's own fields, shared by create and patch — `PATCH /spieler/{spieler_id}` replaces them
 * wholesale, so the two payloads carry the same field set. German messages: these back the admin
 * form's inputs directly.
 *
 * There is deliberately no uniqueness rule on a name. Two people genuinely can share one.
 */
const spielerPayloadFields = {
  // Letters and the three separators a real name uses — see `PersonNameSchema`, which carries the
  // reasoning and the reason it binds the write path alone.
  vorname: PersonNameSchema,
  // Nullable, because a squad is filled in over time and a surname often arrives later than a name
  // on a team sheet. The form submits null for an empty box rather than an empty string.
  nachname: PersonNameSchema.nullable(),
};

// `nachname` is OPTIONAL on the create and required on the patch, mirroring the backend's own
// asymmetry: a create has nothing to overwrite, a patch replaces wholesale and an omitted field
// would erase a stored surname.
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
 * The squad row's own fields, shared by the two junction payloads.
 *
 * A literal mirror of the backend model, transforms included — which is to say none. `nummer` is
 * nullable here and the empty-to-null normalisation happens at the FORM boundary, the same place
 * `nachname` is normalised: a schema that rewrote its input would make `z.infer` disagree with what
 * the form holds, and `apiContract.test.ts` compares this shape to the published document (ADR-0033).
 */
const saisonSpielerPayloadFields = {
  team_id: CustomObjectIdStringSchema,
  // Digits only, at most four. A squad number is free text on the wire — worn rather than counted,
  // and stays a string (ADR-0048) — but free text was never meant to admit a name. The message is
  // German because the action reports it on the field.
  nummer: z
    .string()
    .regex(/^\d{1,4}$/, { error: "Die Nummer besteht aus 1 bis 4 Ziffern." })
    .nullable(),
  position: FLSpielerPositionSchema.nullable(),
  stufe: FLSpielerStufeSchema.nullable(),
  // True when the player joined a season already under way. The create form derives it from the
  // season's status (decided 2026-08-07) rather than asking, so it cannot be forgotten.
  is_nachgetragen: z.boolean(),
  // The squad's captain for this season. On the junction, because captaincy is a role within one
  // team for one season rather than a property of the person.
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
 * What one form submits to create a player AND put them in a squad, which the action splits into two
 * requests (`POST /spieler`, then `POST /spieler/{id}/saisons`). One form on purpose: every squad
 * read is season-scoped with a strict junction join (backend spec I11), so a player created without
 * a junction row is invisible to every surface that could give them one.
 */
export const FLCreateSpielerFormPayloadSchema = z.object({
  ...spielerPayloadFields,
  // Required here and nullable everywhere else (decided 2026-08-07): the column and the patch payload
  // still accept null, because imported squads hold surnameless rows, but a player entered through
  // this form always has one.
  nachname: PersonNameSchema,
  saison_id: z.string().length(4, { error: "Bitte wähle eine Saison." }),
  ...saisonSpielerPayloadFields,
});
export type FLCreateSpielerFormPayload = z.infer<typeof FLCreateSpielerFormPayloadSchema>;

/**
 * Mirrors `FLSpielerSingleResponse` — the person, and only the person.
 *
 * What every write to `spieler` echoes. It carries no team, number, position or stufe because those
 * are season-scoped and live on a junction row, so a player addressed without a season has none of
 * them — inventing a season here would make the answer depend on a default nobody stated.
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
