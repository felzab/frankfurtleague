import z from "zod";

import { BaseAPIResponseSchema } from "@/core/schemas";
import {
  CustomDateStringSchema,
  CustomObjectIdStringSchema,
  ExternalUrlSchema,
  FLAddressPayloadSchema,
  FLAddressSchema,
} from "@/shared/schemas";

import { DESCRIPTION_MAX_LENGTH } from "./constants";

/**
 * Mirrors `FLGruppenNames` — a closed set, so a group outside it is a malformed response. German
 * error because the group picker binds this schema too, and an untouched picker submits null.
 */
export const FLGruppenNamesSchema = z.enum(["A", "B", "C", "D"], { error: "Bitte wähle eine Gruppe." });
export type FLGruppenNames = z.infer<typeof FLGruppenNamesSchema>;

/**
 * Mirrors `FLAustritt`. A team is out of a season exactly when `FLTeam.austritt` is not null, and
 * never a boolean beside it. `FLGruppenTeam.austritt_type` marks the same fact on the grouped row,
 * reusing this enum rather than adding an answer.
 */
export const FLAustrittSchema = z.object({
  // German error because the junction editor binds this schema to its inputs, and an untouched
  // picker submits null.
  type: z.enum(["disqualifikation", "rueckzug"], { error: "Bitte wähle, wie das Team ausgeschieden ist." }),
  // Free text written for publication: rendered as authored, never truncated to a label. German
  // because the junction editor binds this schema to its inputs.
  grund: z.string().nonempty({ error: "Bitte gib einen Grund an. Er wird öffentlich angezeigt." }),
  datum: CustomDateStringSchema,
});
export type FLAustritt = z.infer<typeof FLAustrittSchema>;
export type FLAustrittType = FLAustritt["type"];

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

/**
 * The season-scoped read. `name` and `shorthand` are the junction's copy, so a club renamed after a
 * season finished still reads there under the name it played under (`docs/glossary.md :: Team`).
 */
export const FLTeamSchema = z.object({
  id: CustomObjectIdStringSchema,

  name: z.string().nonempty(),
  gruppe: FLGruppenNamesSchema,

  statistik: FLTeamStatistikSchema,

  // Out of THIS season. Joined from the junction on every read, so it cannot go stale.
  austritt: FLAustrittSchema.nullable(),
  shorthand: z.string().length(2),
  description: z.string().max(DESCRIPTION_MAX_LENGTH),
  full_name: z.string().nonempty(),
  // Rendered straight into an href on a public page -- see ExternalUrlSchema for why not z.url().
  website_url: ExternalUrlSchema,
  address: FLAddressSchema,
  // The day this CLUB left the league — not the same as leaving one season, which is
  // `austritt` on the junction.
  inactive_since: CustomDateStringSchema.nullable(),
});
export type FLTeam = z.infer<typeof FLTeamSchema>;

/**
 * Mirrors `FLGruppenTeam` — one row of a league table, and narrower than `FLTeamSchema` by design.
 * The table is rendered by a client component, so everything here is serialised into a public page,
 * and no cell reads a club's address.
 */
export const FLGruppenTeamSchema = z.object({
  id: CustomObjectIdStringSchema,
  name: z.string().nonempty(),
  shorthand: z.string().length(2),
  statistik: FLTeamStatistikSchema,
  // The record's TYPE alone, reusing the enum rather than restating it: a row marks that a club is
  // out of the season, and the club's own page publishes the reason and the date.
  austritt_type: FLAustrittSchema.shape.type.nullable(),
  // Fixtures neither counted nor called off, so points are still to be awarded here. This is the
  // term that lets a club yet to play its first fixture hold a placing (`docs/backend/spec.md :: I24b`).
  anzahl_ausstehende_spiele: z.int().nonnegative(),
});
export type FLGruppenTeam = z.infer<typeof FLGruppenTeamSchema>;

/**
 * All four keys are required: the backend seeds every group, and an omitted one fails this parse.
 *
 * Each list arrives in STANDING order. **Never re-sort one here** — the same ordering seeds the
 * playoff bracket.
 */
export const FLGruppenSchema = z.object({
  A: z.array(FLGruppenTeamSchema),
  B: z.array(FLGruppenTeamSchema),
  C: z.array(FLGruppenTeamSchema),
  D: z.array(FLGruppenTeamSchema),
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
  address: FLAddressPayloadSchema,
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
  austritt: FLAustrittSchema.nullable(),
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
  // Reported beside the one above and never derived from it: this half reaches only the seasons that
  // are not `past`, so zero is the true answer for a club whose every season is closed.
  fanned_out_to_saison_teams: z.int().nonnegative(),
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
  austritt: FLAustrittSchema.nullable(),
});
export type FLPatchSaisonTeamPayload = z.infer<typeof FLPatchSaisonTeamPayloadSchema>;

/**
 * Which club takes a season's row over. The path names the club going OUT, so this is the one
 * junction payload naming a club the path does not.
 */
export const FLReplaceSaisonTeamPayloadSchema = z.object({
  // Both ids are in the PATH on the wire — the row being handed over is addressed by its natural key.
  team_id: CustomObjectIdStringSchema,
  saison_id: z.string().length(4),
  // The only field on the wire: the row keeps its group, and its copy of the identity is reseeded
  // from the incoming club, so a client-supplied name could only disagree with it.
  incoming_team_id: CustomObjectIdStringSchema,
});
export type FLReplaceSaisonTeamPayload = z.infer<typeof FLReplaceSaisonTeamPayloadSchema>;

/** A junction row, echoed as it was written — it has no read model of its own. */
export const FLSaisonTeamResponseSchema = BaseAPIResponseSchema.extend({
  saison_id: z.string(),
  team_id: CustomObjectIdStringSchema,
  gruppe: FLGruppenNamesSchema,
  austritt: FLAustrittSchema.nullable(),
  // The season's own copy of the club's identity, on no payload: it is seeded from the club at entry
  // and rewritten by a rename only while the season is not `past`, so a client's copy could only be
  // stale.
  name: z.string().nonempty(),
  shorthand: z.string().length(2),
});
export type FLSaisonTeamResponse = z.infer<typeof FLSaisonTeamResponseSchema>;

/**
 * The junction row as a replacement left it, plus the fan-out it carried into the fixtures. No
 * `austritt`: a replacement always clears it, so the field could carry only one value here.
 */
export const FLReplaceSaisonTeamResponseSchema = BaseAPIResponseSchema.extend({
  saison_id: z.string(),
  outgoing_team_id: CustomObjectIdStringSchema,
  incoming_team_id: CustomObjectIdStringSchema,
  // Untouched by the replacement, and echoed because the arriving club has to be told which group it
  // now stands in.
  gruppe: FLGruppenNamesSchema,
  // Reseeded from the incoming club, exactly as entry seeds them.
  name: z.string().nonempty(),
  shorthand: z.string().length(2),
  // Reported rather than assumed, as the rename's count is: this fan-out is the half of the endpoint
  // that fails silently.
  fanned_out_to_spiele: z.int().nonnegative(),
  // The outgoing club's live squad rows for this season, retired by the same transaction. Its own
  // figure beside the fixtures': the players did not transfer, and their registration survives.
  retired_squad_rows: z.int().nonnegative(),
});
export type FLReplaceSaisonTeamResponse = z.infer<typeof FLReplaceSaisonTeamResponseSchema>;
