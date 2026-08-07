/**
 * SPIELER · query parameter types and the admin surfaces' assembled shapes
 *
 * OUTBOUND query shapes, not validation — inbound data is validated by `schemas.ts`.
 *
 * Unlike the other slices, an absent `saison_id` here does NOT resolve to the current season: the
 * squad read is narrowed by `team_id` instead.
 */

import type {
  FLCreateSpielerFormPayload,
  FLPatchSaisonSpielerPayload,
  FLPostSaisonSpielerPayload,
  FLSpielerPosition,
  FLSpielerStufe,
} from "./schemas";

export type FLSpielerSortingOptions = "vorname" | "nachname" | "stufe" | "nummer" | "position";

export type FLSpielerFilterParams = {
  team_id?: string;
  saison_id?: string;
  is_nachgetragen?: boolean;
  stufe?: FLSpielerStufe;
  // Retired people and retired squad rows are excluded unless an admin surface asks for them (ADR-0032).
  include_inactive?: boolean;

  limit?: number;
  sort_by?: FLSpielerSortingOptions;
  order?: "asc" | "desc";
};

/**
 * The create form's draft — the payload the action validates, with the three picked fields widened
 * to `null` so the form can start with nothing chosen instead of silently preselecting a value. The
 * schema accepts the nulls for `position` and `stufe`, which are genuinely optional, and refuses one
 * for `team_id` and `saison_id`, which turns an untouched picker into a field error.
 */
export type SpielerCreateDraft = Omit<FLCreateSpielerFormPayload, "team_id" | "nachname"> & {
  team_id: string | null;
  // Widened for the same reason `team_id` is: the form starts empty and the schema is what turns
  // that into a field error rather than a type error.
  nachname: string | null;
};

/** The squad editor's enter-a-season draft, widened the same way. */
export type SaisonSpielerEnterDraft = Omit<FLPostSaisonSpielerPayload, "team_id"> & {
  team_id: string | null;
};

/** The squad editor's membership draft, widened the same way. */
export type SaisonSpielerMembershipDraft = Omit<FLPatchSaisonSpielerPayload, "team_id"> & {
  team_id: string | null;
};

/**
 * The person's two editable names, as the editor holds them.
 *
 * Its own type rather than `FLPostSpielerPayload`: on the create, `nachname` is genuinely optional
 * because there is nothing to overwrite, while the editor always holds a value for it — `null` when
 * the box is empty. Reusing the create's shape would make the editor's state optional-typed and let
 * an `undefined` reach a patch that treats an omitted field as an erasure.
 */
export type SpielerPersonFields = {
  vorname: string;
  nachname: string | null;
};

/**
 * One STORED squad row, as the pages hand it to the editor and the list.
 *
 * `team_id` is a plain string here and nullable only in the draft types above: a row that exists
 * always names a team — the backend requires it — and the null is purely the state of an untouched
 * picker on a player who has no row yet.
 */
export type SpielerSquadFields = {
  team_id: string;
  nummer: string | null;
  position: FLSpielerPosition | null;
  stufe: FLSpielerStufe | null;
  is_nachgetragen: boolean;
  /** Captain of this team for this season. A role on the junction, not a property of the person. */
  is_captain: boolean;
  /** The day the ROW was retired, or null. Not editable — the retire and reactivate controls own it. */
  inactive_since: string | null;
};

/**
 * The selected season's squad state for one player, assembled by the page: the junction row's fields
 * when the player is in a squad that season, `null` when they are not — which is what the editor's
 * "Aufnehmen" affordance keys off.
 */
export type SpielerSaisonMembership = {
  saisonId: string;
  saisonStatus: "past" | "active" | "future";
  membership: SpielerSquadFields | null;
  /** `rules.erlaubte_stufen` — the only levels this season's picker offers, beside "Keine Angabe". */
  erlaubteStufen: FLSpielerStufe[];
};

/** The season the editor addresses — the sidemenu selector's, resolved by the page. */
export type SpielerSaisonContext = Pick<SpielerSaisonMembership, "saisonId" | "saisonStatus">;

/** One team a squad picker may put a player in, with the season it belongs to. */
export type SpielerTeamOption = {
  teamId: string;
  name: string;
  shorthand: string;
};

/**
 * One season the create form may enter a player into, with that season's teams.
 *
 * `isNachgetragen` is the season's own answer to "did this player join after it started", derived
 * from its status rather than asked (owner, 2026-08-07) — an `active` season is under way, a
 * `future` one has not begun.
 */
export type SpielerCreateSaisonOption = {
  saisonId: string;
  isNachgetragen: boolean;
  teams: SpielerTeamOption[];
  /** `rules.erlaubte_stufen` — the only levels this season's picker offers, beside "Keine Angabe". */
  erlaubteStufen: FLSpielerStufe[];
};

/**
 * One row of the admin player list: EVERY player across every season, carrying the selected season's
 * squad row where one exists. Assembled by the page from `GET /spieler/memberships`, which is the
 * only read that answers the player-centric question (ADR-0034).
 */
export type AdminSpielerRow = {
  id: string;
  vorname: string;
  nachname: string | null;
  /** `vorname nachname`, or the forename alone — what the list searches and sorts on. */
  fullName: string;
  /** The day the PERSON left the league, or null. */
  inactive_since: string | null;
  /** The selected season's squad row, or null when the player is in no squad that season. */
  selected: (SpielerSquadFields & { teamName: string | null; teamShorthand: string | null }) | null;
};
