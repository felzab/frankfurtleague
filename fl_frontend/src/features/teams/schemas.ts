import z from "zod";

import { BaseAPIResponseSchema } from "@/core/schemas";
import { CustomDateStringSchema, CustomObjectIdStringSchema, ExternalUrlSchema, FLAddressSchema } from "@/shared/schemas";

import { DESCRIPTION_MAX_LENGTH } from "./constants";

/**
 * Mirrors `FLGruppenNames` — a closed set, so a group outside it is a malformed response. German
 * error because the group picker binds this schema too, and an untouched picker submits null.
 */
export const FLGruppenNamesSchema = z.enum(["A", "B", "C", "D"], { error: "Bitte wähle eine Gruppe." });
export type FLGruppenNames = z.infer<typeof FLGruppenNamesSchema>;

/**
 * Mirrors `FLDisqualifikation`. A team is disqualified exactly when `FLTeam.disqualifikation` is not
 * null — no boolean beside it on either side of the wire, so no reader has two answers.
 */
export const FLDisqualifikationSchema = z.object({
  // Free text written for publication: rendered as authored, never truncated to a label. German
  // because the junction editor binds this schema to its inputs.
  grund: z.string().nonempty({ error: "Bitte gib einen Grund an. Er wird öffentlich angezeigt." }),
  datum: CustomDateStringSchema,
});
export type FLDisqualifikation = z.infer<typeof FLDisqualifikationSchema>;

export const FLTeamStatistikSchema = z.object({
  anzahl_gespielte_spiele: z.int().nonnegative(),
  siege: z.int().nonnegative(),
  niederlagen: z.int().nonnegative(),
  unentschieden: z.int().nonnegative(),
  tore_geschossen: z.int().nonnegative(),
  tore_kassiert: z.int().nonnegative(),
  punkte: z.int().nonnegative(),
  // Every fixture called off, forfeits included. Beside the scoring, never in it.
  anzahl_abgesagte_spiele: z.int().nonnegative(),
});
export type FLTeamStatistik = z.infer<typeof FLTeamStatistikSchema>;

export const FLTeamSchema = z.object({
  id: CustomObjectIdStringSchema,

  name: z.string().nonempty(),
  gruppe: FLGruppenNamesSchema,

  statistik: FLTeamStatistikSchema,

  // Out of THIS season. Joined from the junction on every read, so it cannot go stale.
  disqualifikation: FLDisqualifikationSchema.nullable(),
  shorthand: z.string().length(2),
  description: z.string().max(DESCRIPTION_MAX_LENGTH),
  full_name: z.string().nonempty(),
  // Rendered straight into an href on a public page -- see ExternalUrlSchema for why not z.url().
  website_url: ExternalUrlSchema,
  address: FLAddressSchema,
  // The day this CLUB left the league — not the same as leaving one season, which is
  // `disqualifikation` on the junction.
  inactive_since: CustomDateStringSchema.nullable(),
});
export type FLTeam = z.infer<typeof FLTeamSchema>;

/**
 * All four keys are required: the backend seeds every group, and an omitted one fails this parse.
 *
 * Each list arrives in STANDING order. **Never re-sort one here** — the same ordering seeds the
 * playoff bracket.
 */
export const FLGruppenSchema = z.object({
  A: z.array(FLTeamSchema),
  B: z.array(FLTeamSchema),
  C: z.array(FLTeamSchema),
  D: z.array(FLTeamSchema),
});
export type FLGruppen = z.infer<typeof FLGruppenSchema>;

export const FLTeamsListResponseSchema = BaseAPIResponseSchema.extend({
  format: z.literal("list"),
  teams: z.array(FLTeamSchema),
});
export type FLTeamsListResponse = z.infer<typeof FLTeamsListResponseSchema>;

export const FLTeamsGroupedResponseSchema = BaseAPIResponseSchema.extend({
  format: z.literal("grouped"),
  gruppen: FLGruppenSchema,
  // The teams in a playoff place are a prefix of each list above, and a page cannot mark them
  // without knowing where that prefix ends.
  qualifiers_per_group: z.int().positive(),
});
export type FLTeamsGroupedResponse = z.infer<typeof FLTeamsGroupedResponseSchema>;

export const FLTeamsResponseSchema = z.discriminatedUnion("format", [FLTeamsListResponseSchema, FLTeamsGroupedResponseSchema]);
export type FLTeamsResponse = z.infer<typeof FLTeamsResponseSchema>;

/**
 * Outside `FLTeamsResponseSchema`: that union discriminates the shapes ONE endpoint can return, and
 * `GET /teams/{team_id}` is a different endpoint returning exactly one.
 */
export const FLTeamsSingleResponseSchema = BaseAPIResponseSchema.extend({
  format: z.literal("single"),
  team: FLTeamSchema,
});
export type FLTeamsSingleResponse = z.infer<typeof FLTeamsSingleResponseSchema>;

/** Shared by create and patch: the patch replaces them wholesale, so both carry the same field set. */
const teamPayloadFields = {
  name: z.string().nonempty({ error: "Bitte gib einen Namen ein." }),
  // Exactly two characters, held unique across every club — retired ones included.
  shorthand: z.string().length(2, { error: "Das Kürzel besteht aus genau 2 Zeichen." }),
  description: z
    .string()
    .max(DESCRIPTION_MAX_LENGTH, { error: `Die Beschreibung darf höchstens ${String(DESCRIPTION_MAX_LENGTH)} Zeichen lang sein.` }),
  full_name: z.string().nonempty({ error: "Bitte gib den vollständigen Namen ein." }),
  website_url: ExternalUrlSchema,
  address: FLAddressSchema,
};

export const FLPostTeamPayloadSchema = z.object(teamPayloadFields);
export type FLPostTeamPayload = z.infer<typeof FLPostTeamPayloadSchema>;

export const FLPatchTeamPayloadSchema = z.object({
  id: CustomObjectIdStringSchema,
  ...teamPayloadFields,
});
export type FLPatchTeamPayload = z.infer<typeof FLPatchTeamPayloadSchema>;

export const FLDeleteTeamPayloadSchema = z.object({
  id: CustomObjectIdStringSchema,
});
export type FLDeleteTeamPayload = z.infer<typeof FLDeleteTeamPayloadSchema>;

export const FLReactivateTeamPayloadSchema = z.object({
  id: CustomObjectIdStringSchema,
});
export type FLReactivateTeamPayload = z.infer<typeof FLReactivateTeamPayloadSchema>;

/**
 * One form, split by the action into two requests. One form on purpose: every list read joins the
 * junction strictly (backend spec I11), so a club created without a row is invisible to every
 * surface that could give it one.
 */
export const FLCreateTeamFormPayloadSchema = z.object({
  ...teamPayloadFields,
  saison_id: z.string().length(4, { error: "Bitte wähle eine Saison." }),
  gruppe: FLGruppenNamesSchema,
});
export type FLCreateTeamFormPayload = z.infer<typeof FLCreateTeamFormPayloadSchema>;

/**
 * Mirrors `FLTeamRecord`, the STORED document that every write echoes. Distinct from `FLTeam`:
 * re-reading the read shape would 404 for a club with no junction row this season — the normal
 * state for one being created or retired.
 */
export const FLTeamRecordSchema = z.object({
  id: CustomObjectIdStringSchema,

  name: z.string().nonempty(),
  shorthand: z.string().length(2),
  description: z.string().max(DESCRIPTION_MAX_LENGTH),
  full_name: z.string().nonempty(),
  website_url: ExternalUrlSchema,
  address: FLAddressSchema,
  inactive_since: CustomDateStringSchema.nullable(),
});
export type FLTeamRecord = z.infer<typeof FLTeamRecordSchema>;

/** Mirrors `FLTeamMembership` — one junction row as seen from its club. */
export const FLTeamMembershipSchema = z.object({
  saison_id: z.string(),
  gruppe: FLGruppenNamesSchema,
  disqualifikation: FLDisqualifikationSchema.nullable(),
});
export type FLTeamMembership = z.infer<typeof FLTeamMembershipSchema>;

/** Mirrors `FLTeamWithMemberships`. A different question from `FLTeam`, not a projection of it. */
export const FLTeamWithMembershipsSchema = FLTeamRecordSchema.extend({
  memberships: z.array(FLTeamMembershipSchema),
});
export type FLTeamWithMemberships = z.infer<typeof FLTeamWithMembershipsSchema>;

export const FLTeamsMembershipsResponseSchema = BaseAPIResponseSchema.extend({
  teams: z.array(FLTeamWithMembershipsSchema),
});
export type FLTeamsMembershipsResponse = z.infer<typeof FLTeamsMembershipsResponseSchema>;

export const FLPostTeamResponseSchema = BaseAPIResponseSchema.extend({
  created_id: CustomObjectIdStringSchema,
});
export type FLPostTeamResponse = z.infer<typeof FLPostTeamResponseSchema>;

export const FLPatchTeamResponseSchema = BaseAPIResponseSchema.extend({
  updated_document: FLTeamRecordSchema,
  // The rename's fan-out is the half of the endpoint that fails silently, so the count is surfaced
  // in the save toast rather than dropped.
  fanned_out_to_spiele: z.int().nonnegative(),
});
export type FLPatchTeamResponse = z.infer<typeof FLPatchTeamResponseSchema>;

/** What retire and reactivate echo — the stored record, for `FLTeamRecordSchema`'s reason. */
export const FLTeamWriteResponseSchema = BaseAPIResponseSchema.extend({
  updated_document: FLTeamRecordSchema,
});
export type FLTeamWriteResponse = z.infer<typeof FLTeamWriteResponseSchema>;

export const FLPostSaisonTeamPayloadSchema = z.object({
  // In the PATH on the wire; carried here because the form has to know which club it is entering.
  team_id: CustomObjectIdStringSchema,
  saison_id: z.string().length(4, { error: "Bitte wähle eine Saison." }),
  gruppe: FLGruppenNamesSchema,
});
export type FLPostSaisonTeamPayload = z.infer<typeof FLPostSaisonTeamPayloadSchema>;

export const FLPatchSaisonTeamPayloadSchema = z.object({
  // Both ids are in the PATH on the wire — the junction row is addressed by its natural key.
  team_id: CustomObjectIdStringSchema,
  saison_id: z.string().length(4),
  gruppe: FLGruppenNamesSchema,
  // The whole record, or `null` to lift one. REQUIRED with no default on either side: a form that
  // omits it gets a 422, never a team quietly reinstated.
  disqualifikation: FLDisqualifikationSchema.nullable(),
});
export type FLPatchSaisonTeamPayload = z.infer<typeof FLPatchSaisonTeamPayloadSchema>;

/** A junction row, echoed as it was written — it has no read model of its own. */
export const FLSaisonTeamResponseSchema = BaseAPIResponseSchema.extend({
  saison_id: z.string(),
  team_id: CustomObjectIdStringSchema,
  gruppe: FLGruppenNamesSchema,
  disqualifikation: FLDisqualifikationSchema.nullable(),
});
export type FLSaisonTeamResponse = z.infer<typeof FLSaisonTeamResponseSchema>;
