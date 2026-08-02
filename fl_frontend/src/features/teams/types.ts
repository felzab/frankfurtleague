/**
 * TEAMS · query parameter types
 *
 * OUTBOUND query shapes, not validation. These describe what the frontend sends; nothing inbound is
 * typed here — that is `schemas.ts`, which validates at the trust boundary.
 *
 * Every field is optional because omission is meaningful: an absent `saison_id` means the current
 * season, and `apiClient` drops undefined params rather than serialising them.
 */

export type FLTeamsSortingOptions = "name";

/**
 * Which matches the derived statistics count (ADR-0029).
 *
 * Omitting it is `"gruppenphase"`, the league table — the backend defaults it there rather than to
 * every phase, because both scopes return the same fields and a forgotten parameter must not produce
 * a standing that counts playoff results.
 */
export type FLTeamStatistikScope = "gruppenphase" | "gesamt";

export type FLTeamsFilterParams = {
  team_id?: string;
  saison_id?: string;
  gruppe?: string;
  is_disqualified?: boolean;
  in_gruppen?: boolean;
  compact?: boolean;
  include_placeholders?: boolean;
  statistik_scope?: FLTeamStatistikScope;

  limit?: number;
  sort_by?: FLTeamsSortingOptions;
  order?: "asc" | "desc";
};
