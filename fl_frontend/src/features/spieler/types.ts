import type { FLPatchSaisonSpielerPayload, FLPostSaisonSpielerPayload, FLSpielerPosition, FLSpielerRolle, FLSpielerStufe } from "./schemas";

/** Mirrors `FLSpielerSortOptions`: every option is a field the base tier serves, and it serves neither `nachname` whole nor `stufe` at all. */
type FLSpielerSortingOptions = "vorname" | "nummer" | "position";

/**
 * A `team_id` without a `saison_id` reads the running season, and 404s while none is active; naming
 * neither lists every season the base tier is not withheld from (`docs/backend/spec.md :: I4`).
 */
export type FLSpielerFilterParams = {
  team_id?: string;
  saison_id?: string;

  limit?: number;
  sort_by?: FLSpielerSortingOptions;
  order?: "asc" | "desc";
};

/** The squad editor's enter-a-season draft: `team_id` widened to `null` so an untouched picker is a field error rather than a type error. */
export type SaisonSpielerEnterDraft = Omit<FLPostSaisonSpielerPayload, "team_id"> & {
  team_id: string | null;
};

/** The squad editor's membership draft, widened the same way. */
export type SaisonSpielerMembershipDraft = Omit<FLPatchSaisonSpielerPayload, "team_id"> & {
  team_id: string | null;
};

// The sign-in address is the admission's to write and no route's to edit, a mistyped one being
// corrected by registering again (`docs/ops/runbooks.md` §5): a field for it here would bind a
// control to a save the API refuses.
/**
 * The editor's own draft rather than a payload type: every field here always holds a value — `null`
 * for an empty box — where an `undefined` reaching the patch erases the stored surname.
 */
export type SpielerPersonFields = {
  vorname: string;
  nachname: string | null;
  geburtsdatum: string | null;
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
  ist_nachnominiert: boolean;
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
  /**
   * The backend's verdict, never the season's status: an active season whose matchday 1 is undated or
   * ahead enters players as ordinary ones. `null` where the player already holds a row, so no entry is offered.
   */
  nachnominierungLaeuft: boolean | null;
};

/** The season the editor addresses — the sidemenu selector's, resolved by the page. */
export type SpielerSaisonContext = Pick<SpielerSaisonMembership, "saisonId" | "saisonStatus">;

/** Where a retired squad row's return to the club it names stands; the editor and the list each word a refusal for their own reader. */
export type RowReturn = "open" | "clubLeft" | "squadFull";

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
  /**
   * **Absent means UNKNOWN and refuses nothing**, the opposite default to `heldRollen`: a write the
   * endpoint may take stays on offer. Set, this team is at the season's `max_kadergroesse` bar the
   * edited player's own row (`REQ-SQUAD-003`).
   */
  isSquadFull?: boolean;
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
