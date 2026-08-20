import type {
  FLAustritt,
  FLAustrittType,
  FLCreateTeamFormPayload,
  FLGruppenNames,
  FLPatchSaisonTeamPayload,
  FLPostSaisonTeamPayload,
} from "./schemas";

export type FLTeamsSortingOptions = "name";

/**
 * Omitting it is `"gruppenphase"`: both scopes return the same fields, so a forgotten parameter must
 * not produce a standing that counts playoff results.
 */
export type FLTeamStatistikScope = "gruppenphase" | "gesamt";

/**
 * What narrows the LIST — one team by its id is an identity, not a filter.
 *
 * Omission is meaningful: an absent `saison_id` means the current season, and `apiClient` drops
 * undefined params rather than serialising them.
 */
export type FLTeamsFilterParams = {
  saison_id?: string;
  gruppe?: string;
  // A question about the junction, not a field on it: the row stores an `austritt` record and
  // no boolean.
  is_disqualified?: boolean;
  in_gruppen?: boolean;
  // Retired clubs are excluded unless an admin picker asks for them.
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
 * The create form's draft, with `gruppe` widened to `null` so the form starts with none chosen. The
 * schema refuses the null, turning an untouched picker into a field error rather than a wrong group.
 */
export type TeamCreateDraft = Omit<FLCreateTeamFormPayload, "gruppe"> & {
  gruppe: FLGruppenNames | null;
};

/** The junction editor's enter-a-season draft, widened the same way. */
export type SaisonTeamEnterDraft = Omit<FLPostSaisonTeamPayload, "gruppe"> & {
  gruppe: FLGruppenNames | null;
};

/**
 * The record mid-edit, with the route widened to `null` so a freshly opened record accuses nobody
 * until somebody chooses. The schema refuses the null the same way it refuses an unpicked group.
 */
export type AustrittDraft = Omit<FLAustritt, "type"> & {
  type: FLAustrittType | null;
};

/** The junction editor's membership draft, widened the same way, record included. */
export type SaisonTeamMembershipDraft = Omit<FLPatchSaisonTeamPayload, "gruppe" | "austritt"> & {
  gruppe: FLGruppenNames | null;
  austritt: AustrittDraft | null;
};

/**
 * The selected season's membership for one club: the junction row, or `null` when the club is not in
 * the season — which is what the editor's "Aufnehmen" affordance keys off.
 */
export type TeamSaisonMembership = {
  saisonId: string;
  saisonStatus: "past" | "active" | "future";
  membership: { gruppe: FLGruppenNames; austritt: FLAustritt | null } | null;
};

/** The season the editor addresses — the sidemenu selector's, resolved by the page. */
export type TeamSaisonContext = Pick<TeamSaisonMembership, "saisonId" | "saisonStatus">;

/**
 * One group's fill state, from `buildGruppeOffer`. The pickers disable a full group; the junction
 * write's refusal (`REQ-ENTER-003`) stays authoritative.
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
 * junction data. Assembled from the per-season reads, because the API's team reads are strictly
 * season-scoped (backend spec I11).
 */
export type AdminTeamRow = {
  id: string;
  name: string;
  full_name: string;
  shorthand: string;
  inactive_since: string | null;
  /** The selected season's junction data, or null when the club is not entered in it. */
  selected: { gruppe: FLGruppenNames; austritt: FLAustritt | null } | null;
  /**
   * No `active` or `future` season holds the club. Mirrors the write path's own refusal
   * (`REQ-RETIRE-001`), which stays authoritative.
   */
  isRetireable: boolean;
};

/**
 * Editable only while the season is `future` or the club has no fixture in it. WHY it is locked
 * belongs to the swap control beneath the row, which grades four conditions where this grades one.
 */
export type TeamGruppeLock = {
  locked: boolean;
};
