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
 *     and `is_disqualified` from a `saison_teams` junction row, plus a `statistik` the backend
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
 *
 *  SEE ALSO ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 *   docs/glossary.md — "Team", for the junction model and "Statistik", for how the table is derived
 */

import z from "zod";

import { BaseAPIResponseSchema } from "@/core/schemas";
import { CustomDateStringSchema, CustomObjectIdStringSchema, ExternalUrlSchema, FLAddressSchema } from "@/shared/schemas";

/** Mirrors `FLGruppenNames`. A closed set, so a group outside it is a malformed response, not a name. */
export const FLGruppenNamesSchema = z.enum(["A", "B", "C", "D"]);
export type FLGruppenNames = z.infer<typeof FLGruppenNamesSchema>;

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

  is_placeholder: z.boolean(),
  is_disqualified: z.boolean(),
  shorthand: z.string().length(2),
  description: z.string(),
  full_name: z.string().nonempty(),
  // Rendered straight into an href on a public page -- see ExternalUrlSchema for why not z.url().
  website_url: ExternalUrlSchema,
  address: FLAddressSchema,
  // The day this CLUB left the league, null while it plays (ADR-0032). Not the same thing as leaving
  // one season -- that is `is_disqualified`, which lives on the junction (ADR-0033).
  inactive_since: CustomDateStringSchema.nullable(),
});
export type FLTeam = z.infer<typeof FLTeamSchema>;

/** All four keys are required: the backend seeds every group, and an omitted one fails this parse. */
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
