import type {
  FLCreateSpielerFormPayload,
  FLPatchSaisonSpielerPayload,
  FLPostSaisonSpielerPayload,
  FLSpielerPosition,
  FLSpielerRolle,
  FLSpielerStufe,
} from "./schemas";

/** Mirrors `FLSpielerSortOptions`: every option is a field the base tier serves, and it serves neither `nachname` whole nor `stufe` at all. */
type FLSpielerSortingOptions = "vorname" | "nummer" | "position";

/**
 * An absent `saison_id` does NOT resolve to the current season here: the read narrows by `team_id`,
 * and by nothing the base tier withholds or hides (`READ-PUPIL-002`, `READ-SQUAD-002`).
 */
export type FLSpielerFilterParams = {
  team_id?: string;
  saison_id?: string;

  limit?: number;
  sort_by?: FLSpielerSortingOptions;
  order?: "asc" | "desc";
};

/**
 * The create form's draft: `team_id` and `nachname` widened to `null` so the form can start empty.
 * The schema refuses both nulls, making an untouched picker a field error rather than a type error.
 */
export type SpielerCreateDraft = Omit<FLCreateSpielerFormPayload, "team_id" | "nachname"> & {
  team_id: string | null;
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
 * Its own type rather than `FLPostSpielerPayload`, whose `nachname` is optional: the editor always
 * holds a value — `null` for an empty box — and an `undefined` reaching the patch erases the
 * stored surname.
 */
export type SpielerPersonFields = {
  vorname: string;
  nachname: string | null;
};

/**
 * One STORED squad row. `team_id` is plain here and nullable only in the drafts above: a row that
 * exists always names a team, and the null is only an untouched picker's state.
 */
type SpielerSquadFields = {
  team_id: string;
  nummer: string | null;
  position: FLSpielerPosition | null;
  stufe: FLSpielerStufe | null;
  is_nachgetragen: boolean;
  /** A role on the junction, not a property of the person. `null` is the ordinary state. */
  rolle: FLSpielerRolle | null;
  /** The day the ROW was retired. Not editable — the retire and reactivate controls own it. */
  inactive_since: string | null;
};

/**
 * The selected season's squad state for one player: the junction row, or `null` when they are in no
 * squad that season — which is what the editor's "Aufnehmen" affordance keys off.
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
  /**
   * Who already holds each role in this team this season, bar the edited player's own row.
   *
   * **Absent means UNKNOWN, not free**: a caller that cannot answer must not make the editor offer
   * a role the write path would refuse.
   */
  heldRollen?: Partial<Record<FLSpielerRolle, string>>;
};

/**
 * `isNachgetragen` is derived from the season's status rather than asked: an `active` season is
 * under way, a `future` one has not begun.
 */
export type SpielerCreateSaisonOption = {
  saisonId: string;
  isNachgetragen: boolean;
  teams: SpielerTeamOption[];
  /** The season's `rules.erlaubte_stufen`, as on `SpielerSaisonMembership`. */
  erlaubteStufen: FLSpielerStufe[];
};

/**
 * One row of the admin player list: EVERY player across every season, carrying the selected season's
 * squad row where one exists. Assembled from `GET /spieler/memberships`.
 */
export type AdminSpielerRow = {
  id: string;
  vorname: string;
  nachname: string | null;
  /** `vorname nachname`, or the forename alone — what the list searches and sorts on. */
  fullName: string;
  /** The day the PERSON left the league. */
  inactive_since: string | null;
  selected: (SpielerSquadFields & { teamName: string | null; teamShorthand: string | null }) | null;
};
