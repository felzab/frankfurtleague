/**
 * SAISONS · query parameter types and the admin surfaces' assembled shapes
 *
 * Outbound query shapes, not validation — inbound data is validated by `schemas.ts`.
 *
 * Note `sort_by: "_id"` sorts by the season id, which is the four-character year string, so it sorts
 * chronologically. That is a property of the id format, not a coincidence.
 */

import type { FLGruppenNames } from "../teams/schemas";
import type { FLSaisonRules, FLSaisonStatus } from "./schemas";

export type FLSaisonsSortOptions = "_id" | "start_date" | "end_date";

export type FLSaisonsFilterParams = {
  saison_id?: string;
  status?: string;

  limit?: number;
  sort_by?: FLSaisonsSortOptions;
  order?: "asc" | "desc";
};

/**
 * The season's editable fields as the editor holds them — dates plus every field of `rules`.
 *
 * `status` is absent, and it is absent from the payload schemas for the same reason: the
 * rollover endpoint is the only code path that writes it. Nothing on this page can put it in a draft.
 */
export type SaisonDraftFields = {
  start_date: string;
  end_date: string;
  rules: FLSaisonRules;
};

/**
 * One row of the admin season list.
 *
 * `spieltageCount` and `teamsCount` are what make the list readable as a setup surface: together they
 * say whether a season has a schedule and a field yet, which is the question the list is scanned for.
 * Neither is the rollover precondition — that is the endpoint's (`REQ-ACTIVATE-001`), and the season
 * editor's rollover panel is where it is shown.
 */
export type AdminSaisonRow = {
  id: string;
  start_date: string;
  end_date: string;
  status: FLSaisonStatus;
  rules: FLSaisonRules;
  /** How many matchdays this season has, retired ones included. */
  spieltageCount: number;
  teamsCount: number;
};

/**
 * One match of the outgoing season that has no result, as the rollover panel lists it.
 *
 * Deliberately not the whole `FLSpiel`: the panel needs enough to recognise a fixture and a link to
 * open it, and shipping the joined shape would send every referee, venue and provenance record of an
 * unfinished season to the client to render a list of names.
 */
export type SaisonOffeneSpiel = {
  id: string;
  spielNr: number;
  datum: string | null;
  /** `Team A – Team B`, with a placeholder where the bracket has not filled a side yet. */
  paarung: string;
};

/**
 * What the rollover control knows about the season it would replace.
 *
 * `null` when no season currently holds `active`, which is a legitimate state on a fresh database and
 * makes the rollover the plain promotion it would otherwise be dressed up as.
 */
export type SaisonRolloverContext = {
  outgoingSaisonId: string | null;
  /** Every unfinished match of the OUTGOING season. Empty when there is nothing to warn about. */
  offeneSpiele: SaisonOffeneSpiel[];
};

/**
 * One club the swap control can pick, as it stands in THIS season.
 *
 * Deliberately not the whole `FLTeam`: the control needs a name to show and a group to pair on, and the
 * derived `statistik` behind every team read is a table it never draws.
 */
export type SaisonSwapTeam = {
  id: string;
  name: string;
  gruppe: FLGruppenNames;
  /**
   * How many of this club's own Gruppenphase fixtures have taken place, per the season editor page's
   * `hasTakenPlace`, which is where that reading is stated in full.
   *
   * `REQ-SWAP-004` counted for one club. Non-zero is what makes it unpickable: the group phase is a
   * round robin, so a club that has played inside its group cannot leave it.
   */
  gespielteGruppenSpiele: number;
  /**
   * Spieltag id → how many of this club's Gruppenphase fixtures sit on it. A swap MOVES every one of
   * these to the other club.
   */
  gruppenSpieleProSpieltag: Record<string, number>;
  /**
   * Spieltag id → how many of this club's fixtures OUTSIDE the group phase sit on it. A swap leaves
   * every one of these where it is, which is what lets an exchange put a club on one Spieltag twice.
   *
   * The two maps together are `REQ-SWAP-005` said in the form: `wouldFieldAClubTwice` mirrors the
   * arithmetic `_spieltag_clashes` performs on the server.
   */
  koSpieleProSpieltag: Record<string, number>;
};

/**
 * What the group swap control knows about the season it is standing on.
 *
 * `playedKnockoutSpiele` is the endpoint's own window rule, counted for the page: any fixture outside
 * the Gruppenphase that has taken place closes the swap for good, because the bracket was seeded from
 * these groups. Non-zero is what turns the control into an explanation. Same reading as the field above.
 */
export type SaisonGruppenSwapContext = {
  /** Every club entered in this season, retired ones included, ordered by name. */
  teams: SaisonSwapTeam[];
  playedKnockoutSpiele: number;
};
