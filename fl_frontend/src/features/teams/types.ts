import type { KontaktRolle } from "./constants";
import type {
  FLAustritt,
  FLAustrittType,
  FLCreateTeamFormPayload,
  FLGruppenNames,
  FLKontaktEinwilligung,
  FLKontaktperson,
  FLPatchSaisonTeamPayload,
  FLPostSaisonTeamPayload,
  FLSaisonTeamKontakte,
  FLTrikotFarbe,
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
export type FLPublicTeamsFilterParams = {
  saison_id?: string;
  gruppe?: FLGruppenNames;
  // A question about the junction, not a field on it: the row stores an `austritt` record and
  // no boolean.
  has_austritt?: boolean;
  // Independent of the boolean rather than nested under it: naming a route already implies having
  // left, so the two combine without either implying the other.
  austritt_type?: FLAustrittType;
  in_gruppen?: boolean;
  statistik_scope?: FLTeamStatistikScope;

  limit?: number;
  sort_by?: FLTeamsSortingOptions;
  order?: "asc" | "desc";
};

/**
 * The admin read's filters. `include_inactive` is here and not above because the base endpoint
 * stopped declaring it: a public standings row carries no retirement date, so un-hiding a retired
 * club there would serve one nothing marks (`READ-SQUAD-002`).
 */
export type FLTeamsFilterParams = FLPublicTeamsFilterParams & {
  include_inactive?: boolean;
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

/**
 * The agreement mid-edit, with its origin widened to `null` so a freshly opened block claims nobody's
 * word until somebody says whose it is. The schema refuses the null, as it refuses an unpicked route.
 */
export type KontaktEinwilligungDraft = Omit<FLKontaktEinwilligung, "erteilt_von"> & {
  erteilt_von: FLKontaktEinwilligung["erteilt_von"] | null;
};

/** One contact person mid-edit. Every other field is typed, so an unanswered one is the empty string. */
export type KontaktpersonDraft = Omit<FLKontaktperson, "einwilligung"> & {
  einwilligung: KontaktEinwilligungDraft;
};

/**
 * The season's three seats mid-edit. A seat is `null` where nobody is recorded in it, which is the
 * state an erasure leaves and the one the payload accepts.
 */
export type SaisonTeamKontakteDraft = Omit<FLSaisonTeamKontakte, "trainer" | "ansprechperson" | "stellvertretung"> & {
  trainer: KontaktpersonDraft | null;
  ansprechperson: KontaktpersonDraft | null;
  stellvertretung: KontaktpersonDraft | null;
};

/**
 * The junction editor's membership draft, widened the same way, record included. No `kontakte` — the
 * payload does not carry the block, and the three seats are the contacts editor's to move.
 */
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
  membership: {
    gruppe: FLGruppenNames;
    austritt: FLAustritt | null;
    trikot_farbe: FLTrikotFarbe | null;
    kontakte: FLSaisonTeamKontakte | null;
  } | null;
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
 * Editable only while the club holds no fixture in the season, whatever the season's status
 * (`REQ-ENTER-004`). WHY it is locked belongs to the swap control beneath the row, which grades four
 * conditions where this grades one.
 */
export type TeamGruppeLock = {
  locked: boolean;
};

/**
 * One seat within a team's row. The seat is a SLOT and not a record: `saison_teams.kontakte` is an
 * embedded object with three named keys, so a seat has no id of its own to be listed under.
 */
export type AdminKontaktSeat = {
  rolle: KontaktRolle;
  label: string;
  /**
   * Null where nobody is recorded in the seat. One nullable block rather than five nullable fields:
   * a seat can then hold a whole person or none, never a name with no way to reach it.
   */
  person: {
    vorname: string;
    nachname: string;
    email: string;
    telefon: string;
    einwilligung: FLKontaktEinwilligung;
  } | null;
  /**
   * This seat and the Trainer's really hold one person, the assertion having been checked against the
   * two records. Graded once here, so no cell can restate it from the flag alone.
   */
  istTrainerZugleich: boolean;
};

/**
 * One club's contacts for ONE season — the shape a record actually has. Keyed by the club, because
 * `kontakte` hangs off the junction row and the three seats inside it have no identity to be keyed by.
 */
export type AdminKontakteRow = {
  /** The club's id: one junction row per club per season, so it is the row's whole identity. */
  id: string;
  teamId: string;
  teamName: string;
  teamShorthand: string;
  /** All three, always, in the order the editor asks for them — an empty seat is what an erasure leaves. */
  seats: readonly AdminKontaktSeat[];
  /** Seats HELD, never the three the block always carries: it is what the completeness badge reads. */
  besetzt: number;
};
