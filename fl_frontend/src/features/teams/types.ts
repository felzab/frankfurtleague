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

/** What narrows the LIST. One team by its id is an identity — `getTeam(id)` — not a filter (ADR-0034). */
export type FLTeamsFilterParams = {
  saison_id?: string;
  gruppe?: string;
  // A question about the junction, not a field on it: the row stores a `disqualifikation` record and
  // no boolean, and the backend translates this into a null test (ADR-0059).
  is_disqualified?: boolean;
  in_gruppen?: boolean;
  // Retired clubs are excluded unless an admin picker asks for them (ADR-0032).
  include_inactive?: boolean;
  statistik_scope?: FLTeamStatistikScope;

  limit?: number;
  sort_by?: FLTeamsSortingOptions;
  order?: "asc" | "desc";
};

/** What `GET /teams/{team_id}` accepts: only the two choosing which season's figures to derive. */
export type FLTeamSingleFilterParams = {
  saison_id?: string;
  statistik_scope?: FLTeamStatistikScope;
};
