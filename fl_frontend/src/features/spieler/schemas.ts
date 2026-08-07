/**
 * SPIELER · models
 *
 * Mirrors `fl_backend/app/api/spieler/schemas.py`. No generation step — a constraint changed there
 * must be changed here in the same commit, and `src/core/apiContract.test.ts` checks the wire
 * contract half of that (ADR-0040).
 *
 *  INVARIANTS ───────────────────────────────────────────────────────────────────────────────────────────
 *
 *   • Only `vorname` is mandatory. The rest may legitimately be absent for a squad entry that has not
 *     been filled in — and the nullability is not cosmetic: the backend already declared these fields
 *     nullable while this schema did not, so a real null threw `APIMalformedDataError` on a valid
 *     response.
 *   • `nummer` is a STRING and stays free text. A squad number is worn rather than counted, and it is
 *     not unique within a squad.
 *   • `position` and `stufe` are CLOSED SETS (ADR-0061), so a value outside either is a malformed
 *     response rather than an unusual player.
 *   • `FLSpieler` is one player FLATTENED against one season and carries no `saison_id`. The admin
 *     surfaces read `FLSpielerWithMemberships` instead, which is a different question (ADR-0034).
 *
 *  DECISIONS ────────────────────────────────────────────────────────────────────────────────────────────
 *
 *   ADR-0032  the person and the squad row retire independently
 *   ADR-0034  the write path is resource-first, and the admin read is its own question
 *   ADR-0061  position and stufe are closed sets
 */

import z from "zod";

import { BaseAPIResponseSchema } from "@/core/schemas";
import { CustomDateStringSchema, CustomObjectIdStringSchema } from "@/shared/schemas";

/**
 * Mirrors `FLSpielerPosition`. German error because the squad editor's picker binds this schema too,
 * and an untouched picker submits null — which this refuses and the nullable wrappers below allow.
 */
export const FLSpielerPositionSchema = z.enum(["Tor", "Abwehr", "Mittelfeld", "Angriff"], { error: "Bitte wähle eine Position." });
export type FLSpielerPosition = z.infer<typeof FLSpielerPositionSchema>;

/** Mirrors `FLSpielerStufe` — the Hessen Oberstufe, both phases (ADR-0061). */
export const FLSpielerStufeSchema = z.enum(["E1", "E2", "Q1", "Q2", "Q3", "Q4"], { error: "Bitte wähle eine Stufe." });
export type FLSpielerStufe = z.infer<typeof FLSpielerStufeSchema>;

// Mirrors the backend FLSpieler. Only vorname is mandatory; the rest may legitimately be absent
// for a player whose squad entry has not been filled in yet. The backend already declared these
// nullable — the frontend did not, so a null would have thrown APIMalformedDataError.
export const FLSpielerSchema = z.object({
  id: CustomObjectIdStringSchema,
  vorname: z.string(),
  nachname: z.string().nullable(),
  stufe: FLSpielerStufeSchema.nullable(),
  nummer: z.string().nullable(),
  position: FLSpielerPositionSchema.nullable(),
  is_nachgetragen: z.boolean(),
  team_id: CustomObjectIdStringSchema,
  // The day this player left the club, null while they are on a squad (ADR-0032). Declared because
  // the backend sends it: zod's default strip mode discards an undeclared field with no error.
  inactive_since: CustomDateStringSchema.nullable(),
});
export type FLSpieler = z.infer<typeof FLSpielerSchema>;

export const FLSpielerListResponseSchema = BaseAPIResponseSchema.extend({
  spieler: z.array(FLSpielerSchema),
});
export type FLSpielerListResponse = z.infer<typeof FLSpielerListResponseSchema>;

// ── The admin read (FB-3) ────────────────────────────────────────────────────────────────────────────

/**
 * Mirrors `FLSpielerMembership` — one squad row as seen from its player.
 *
 * Carries `inactive_since`, which the team junction's equivalent does not: a squad row really is
 * retired when a player leaves a team mid-season, while a team never leaves a season (ADR-0033).
 */
export const FLSpielerMembershipSchema = z.object({
  saison_id: z.string(),
  team_id: CustomObjectIdStringSchema,
  nummer: z.string().nullable(),
  position: FLSpielerPositionSchema.nullable(),
  stufe: FLSpielerStufeSchema.nullable(),
  is_nachgetragen: z.boolean(),
  inactive_since: CustomDateStringSchema.nullable(),
});
export type FLSpielerMembership = z.infer<typeof FLSpielerMembershipSchema>;

/**
 * Mirrors `FLSpielerWithMemberships` — the person as stored, plus every squad row they hold.
 *
 * The admin list's one read, and a different question from `FLSpieler` rather than a projection of
 * it (ADR-0034): that shape is flattened against one season, so it cannot report a player in two and
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

// ── The write path (FB-3) ────────────────────────────────────────────────────────────────────────────

/**
 * The person's own fields, shared by create and patch — `PATCH /spieler/{spieler_id}` replaces them
 * wholesale, so the two payloads carry the same field set. German messages: these back the admin
 * form's inputs directly.
 *
 * There is deliberately no uniqueness rule on a name. Two people genuinely can share one.
 */
const spielerPayloadFields = {
  vorname: z.string().nonempty({ error: "Bitte gib einen Vornamen ein." }),
  // Nullable, because a squad is filled in over time and a surname often arrives later than a name
  // on a team sheet. The form submits null for an empty box rather than an empty string.
  nachname: z.string().nonempty({ error: "Bitte gib einen Nachnamen ein." }).nullable(),
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
 * the form holds, and `apiContract.test.ts` compares this shape to the published document (ADR-0040).
 */
const saisonSpielerPayloadFields = {
  team_id: CustomObjectIdStringSchema,
  nummer: z.string().nullable(),
  position: FLSpielerPositionSchema.nullable(),
  stufe: FLSpielerStufeSchema.nullable(),
  // True when the player joined a season already under way. The create form derives it from the
  // season's status (owner, 2026-08-07) rather than asking, so it cannot be forgotten.
  is_nachgetragen: z.boolean(),
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
 * read is season-scoped with a strict junction join (I11), so a player created without a junction
 * row would be invisible to every surface that could give them one.
 */
export const FLCreateSpielerFormPayloadSchema = z.object({
  ...spielerPayloadFields,
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
  inactive_since: CustomDateStringSchema.nullable(),
});
export type FLSaisonSpielerResponse = z.infer<typeof FLSaisonSpielerResponseSchema>;
