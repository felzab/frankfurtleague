/**
 * TEAMS · query parameter types
 *
 * OUTBOUND query shapes, not validation. These describe what the frontend sends; nothing inbound is
 * typed here — that is `schemas.ts`, which validates at the trust boundary.
 *
 * Every field is optional because omission is meaningful: an absent `saison_id` means the current
 * season, and `apiClient` drops undefined params rather than serialising them.
 */

import type { FLCreateTeamFormPayload, FLDisqualifikation, FLGruppenNames, FLPatchSaisonTeamPayload, FLPostSaisonTeamPayload } from "./schemas";

export type FLTeamsSortingOptions = "name";

/**
 * Which matches the derived statistics count (ADR-0022).
 *
 * Omitting it is `"gruppenphase"`, the league table — the backend defaults it there rather than to
 * every phase, because both scopes return the same fields and a forgotten parameter must not produce
 * a standing that counts playoff results.
 */
export type FLTeamStatistikScope = "gruppenphase" | "gesamt";

/** What narrows the LIST. One team by its id is an identity — `getTeam(id)` — not a filter (ADR-0027). */
export type FLTeamsFilterParams = {
  saison_id?: string;
  gruppe?: string;
  // A question about the junction, not a field on it: the row stores a `disqualifikation` record and
  // no boolean, and the backend translates this into a null test (ADR-0047).
  is_disqualified?: boolean;
  in_gruppen?: boolean;
  // Retired clubs are excluded unless an admin picker asks for them (ADR-0025).
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

/**
 * The create form's draft — the payload the action validates, with `gruppe` widened to `null` so the
 * form can start with no group chosen instead of silently preselecting "A". The schema refuses the
 * null, which is what turns an untouched picker into a field error rather than a wrong group.
 */
export type TeamCreateDraft = Omit<FLCreateTeamFormPayload, "gruppe"> & {
  gruppe: FLGruppenNames | null;
};

/** The junction editor's enter-a-season draft — `gruppe` widened to null for the untouched picker. */
export type SaisonTeamEnterDraft = Omit<FLPostSaisonTeamPayload, "gruppe"> & {
  gruppe: FLGruppenNames | null;
};

/** The junction editor's membership draft, widened the same way. */
export type SaisonTeamMembershipDraft = Omit<FLPatchSaisonTeamPayload, "gruppe"> & {
  gruppe: FLGruppenNames | null;
};

/**
 * The selected season's membership state for one club, assembled by the team page: the junction
 * row's two fields when the club is in the season, `null` when it is not — which is what the
 * editor's "Aufnehmen" affordance keys off.
 */
export type TeamSaisonMembership = {
  saisonId: string;
  saisonStatus: "past" | "active" | "future";
  membership: { gruppe: FLGruppenNames; disqualifikation: FLDisqualifikation | null } | null;
};

/** The season the editor addresses — the sidemenu selector's, resolved by the page. */
export type TeamSaisonContext = Pick<TeamSaisonMembership, "saisonId" | "saisonStatus">;

/**
 * One group's fill state in one season, derived from the season's `rules` and the memberships read
 * (`buildGruppeOffer`). The pickers disable a full group; the junction write's refusal
 * (REQ-ENTER-003) stays authoritative.
 */
export type GruppeOffer = {
  gruppe: FLGruppenNames;
  occupied: number;
  capacity: number;
};

/** One PLANNED season the create form may enter a team into, with its groups' fill state. */
export type TeamCreateSaisonOption = {
  saisonId: string;
  offer: GruppeOffer[];
};

/**
 * One row of the admin club list: EVERY club across every season, carrying the selected season's
 * junction data where the club is entered there (decided 2026-08-07 — the list is club-centric, the
 * season columns follow the sidemenu selector). Assembled by the page from the per-season reads,
 * because the API's team reads are strictly season-scoped (backend spec I11).
 */
export type AdminTeamRow = {
  id: string;
  name: string;
  full_name: string;
  shorthand: string;
  inactive_since: string | null;
  /** The selected season's junction data, or null when the club is not entered in it. */
  selected: { gruppe: FLGruppenNames; disqualifikation: FLDisqualifikation | null } | null;
  /**
   * No `active` or `future` season holds the club, so retiring is offered. Mirrors the write path's
   * own refusal (`REQ-RETIRE-001`), which stays authoritative.
   */
  isRetireable: boolean;
};

/**
 * Whether the group may be edited, decided by the page from the season's status and the club's
 * fixtures (decided 2026-08-07): editable only while the season is `future` or the club has
 * no fixture in it. `draftChangesGruppe` is the form's own live addition — it is what raises the
 * warning callout while an edit is pending.
 */
export type TeamGruppeLock = {
  locked: boolean;
  /** The sentence shown under the read-only group, naming why it is locked. */
  reason: string;
  draftChangesGruppe: boolean;
};
