/**
 * TEAMS · models
 *
 * Mirrors `fl_backend/app/api/teams/schemas.py`. No generation step — a constraint changed there must
 * be changed here in the same commit, and `src/core/apiContract.test.ts` checks the wire contract
 * half of that (ADR-0040).
 *
 *  INVARIANTS ───────────────────────────────────────────────────────────────────────────────────────────
 *
 *   • `FLTeam` looks like one document and is not: the season-independent team record, plus `gruppe`
 *     and `disqualifikation` from a `saison_teams` junction row, plus a `statistik` the backend
 *     computes from that season's matches. All three sources are why those fields are season-dependent.
 *   • The grouped response requires ALL FOUR group keys. A backend that builds the map from the teams
 *     present omits an empty group, and this parse then fails and takes down the table page.
 *   • `website_url` is scheme-restricted, because it is rendered into an href on a public page.
 *   • There is ONE team shape. Never add a reduced mirror beside it (ADR-0034).
 *
 *  DECISIONS ────────────────────────────────────────────────────────────────────────────────────────────
 *
 *   ADR-0032  `inactive_since` is the day the club left the league
 *   ADR-0034  one team shape; `GET /teams/{id}` is its own response
 *   ADR-0040  the wire contract is checked against the published OpenAPI document
 *   ADR-0059  a disqualification is a record, and its absence is the null
 *
 *  SEE ALSO ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 *   docs/glossary.md — "Team", for the junction model and "Statistik", for how the table is derived
 */

import z from "zod";

import { BaseAPIResponseSchema } from "@/core/schemas";
import { CustomDateStringSchema, CustomObjectIdStringSchema, ExternalUrlSchema, FLAddressSchema } from "@/shared/schemas";

/**
 * Mirrors `FLGruppenNames`. A closed set, so a group outside it is a malformed response, not a name.
 * German error because the group picker binds this schema too, and an untouched picker submits null.
 */
export const FLGruppenNamesSchema = z.enum(["A", "B", "C", "D"], { error: "Bitte wähle eine Gruppe." });
export type FLGruppenNames = z.infer<typeof FLGruppenNamesSchema>;

/**
 * Mirrors `FLDisqualifikation` — why a team is out of one season, and from when (ADR-0059).
 *
 * A team is disqualified exactly when `FLTeam.disqualifikation` is not null. There is no boolean
 * beside it on either side of the wire, so no reader has two answers to choose between.
 *
 * `grund` is free text written for publication, so it renders as authored — never truncated to a
 * label, and never parsed for a category it does not carry.
 */
export const FLDisqualifikationSchema = z.object({
  // German because the junction editor binds this schema to its inputs (ADR-0050); on a response
  // parse the message is only ever logged.
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
});
export type FLTeamStatistik = z.infer<typeof FLTeamStatistikSchema>;

export const FLTeamSchema = z.object({
  id: CustomObjectIdStringSchema,

  name: z.string().nonempty(),
  gruppe: FLGruppenNamesSchema,

  statistik: FLTeamStatistikSchema,

  // Out of THIS season, or null while the team competes (ADR-0059). Joined from the junction by the
  // backend on every read, so it cannot go stale against a match document.
  disqualifikation: FLDisqualifikationSchema.nullable(),
  shorthand: z.string().length(2),
  description: z.string().max(4096),
  full_name: z.string().nonempty(),
  // Rendered straight into an href on a public page -- see ExternalUrlSchema for why not z.url().
  website_url: ExternalUrlSchema,
  address: FLAddressSchema,
  // The day this CLUB left the league, null while it plays (ADR-0032). Not the same thing as leaving
  // one season -- that is `disqualifikation`, which lives on the junction (ADR-0033).
  inactive_since: CustomDateStringSchema.nullable(),
});
export type FLTeam = z.infer<typeof FLTeamSchema>;

/**
 * All four keys are required: the backend seeds every group, and an omitted one fails this parse.
 *
 * Each list arrives in STANDING order — points, goal difference, goals scored, then the head-to-head
 * table among whoever is still level (ADR-0043). Never re-sort one here: the same ordering seeds the
 * playoff bracket, and a second sort in the client is a second answer to who finished second.
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
  // The season's own `rules.qualifiers_per_group`, carried beside the table it applies to: the teams in
  // a playoff place are a prefix of each list above, and a page cannot mark them without knowing where
  // that prefix ends. On the grouped shape only — a flat list is sorted by name and is not a standing.
  qualifiers_per_group: z.int().positive(),
});
export type FLTeamsGroupedResponse = z.infer<typeof FLTeamsGroupedResponseSchema>;

export const FLTeamsResponseSchema = z.discriminatedUnion("format", [FLTeamsListResponseSchema, FLTeamsGroupedResponseSchema]);
export type FLTeamsResponse = z.infer<typeof FLTeamsResponseSchema>;

/**
 * Deliberately outside `FLTeamsResponseSchema`: that union discriminates the shapes ONE endpoint can
 * return, and `GET /teams/{team_id}` is a different endpoint returning exactly one (ADR-0034).
 */
export const FLTeamsSingleResponseSchema = BaseAPIResponseSchema.extend({
  format: z.literal("single"),
  team: FLTeamSchema,
});
export type FLTeamsSingleResponse = z.infer<typeof FLTeamsSingleResponseSchema>;

// ── The write path (FB-3) ────────────────────────────────────────────────────────────────────────────

/**
 * The club's own fields, shared by create and patch — `PATCH /teams/{team_id}` replaces them
 * wholesale, so the two payloads carry the same field set. German messages: these back the admin
 * form's inputs directly.
 */
const teamPayloadFields = {
  name: z.string().nonempty({ error: "Bitte gib einen Namen ein." }),
  // Exactly two characters, held unique across every club — retired ones included (ADR-0032).
  shorthand: z.string().length(2, { error: "Das Kürzel besteht aus genau 2 Zeichen." }),
  description: z.string().max(4096, { error: "Die Beschreibung darf höchstens 4096 Zeichen lang sein." }),
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
 * What one form submits to create a club AND enter it into a season, which the action splits into
 * two requests (`POST /teams`, then `POST /teams/{id}/saisons`). One form on purpose: every list
 * read is season-scoped with a strict junction join (I11), so a club created without a junction row
 * would be invisible to every surface that could give it one.
 */
export const FLCreateTeamFormPayloadSchema = z.object({
  ...teamPayloadFields,
  saison_id: z.string().length(4, { error: "Bitte wähle eine Saison." }),
  gruppe: FLGruppenNamesSchema,
});
export type FLCreateTeamFormPayload = z.infer<typeof FLCreateTeamFormPayloadSchema>;

/**
 * Mirrors `FLTeamRecord` — the club document as it is STORED, which is what every write echoes.
 *
 * Distinct from `FLTeam` on purpose: a write changes nothing season-scoped, and re-reading the read
 * shape would 404 for a club with no junction row in the current season — the normal state for a
 * club being created, retired or reactivated.
 */
export const FLTeamRecordSchema = z.object({
  id: CustomObjectIdStringSchema,

  name: z.string().nonempty(),
  shorthand: z.string().length(2),
  description: z.string().max(4096),
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

/**
 * Mirrors `FLTeamWithMemberships` — the stored club record plus every season membership it holds.
 * The admin list's one read; a different question from `FLTeam`, not a projection of it (ADR-0034).
 */
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
  // How many embedded copies the rename reached (ADR-0028 rule 3). The fan-out is the half of the
  // endpoint that fails silently, so the count is surfaced in the save toast rather than dropped.
  fanned_out_to_spiele: z.int().nonnegative(),
});
export type FLPatchTeamResponse = z.infer<typeof FLPatchTeamResponseSchema>;

/** What retire and reactivate echo — the stored record, for the reason stated on it. */
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
  // The whole record, or `null` to lift one. REQUIRED with no default on either side (ADR-0059): a
  // form that omits it gets a 422, never a team quietly reinstated.
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
