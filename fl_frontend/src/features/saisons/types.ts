import type { FLGruppenNames } from "../teams/schemas";
import type { FLSaisonPhaseSchedule, FLSaisonRules, FLSaisonSpielplan, FLSaisonStatus } from "./schemas";

// `"_id"` sorts chronologically: the season id is the four-character year string. A property of the
// id format rather than a coincidence.
export type FLSaisonsSortOptions = "_id" | "start_date" | "end_date";

export type FLSaisonsFilterParams = {
  // No `saison_id`: this narrows a LIST, where `GET /saisons/{saison_id}` names one. The endpoint
  // declares no such parameter, and an undeclared one is dropped in silence rather than refused.
  status?: FLSaisonStatus;

  limit?: number;
  sort_by?: FLSaisonsSortOptions;
  order?: "asc" | "desc";
};

/**
 * One entry of the season switcher. Deliberately not `FLSaison`: the switcher is a Client Component,
 * so a season's `rules`, `status` and `spielplan` would otherwise be serialised into the Flight
 * payload of every page that renders the shell.
 */
export type SaisonSelectorOption = {
  id: string;
  start_date: string;
  end_date: string;
};

export type SaisonDraftFields = {
  start_date: string;
  end_date: string;
  rules: FLSaisonRules;
};

/**
 * One row of the admin season list. Neither count is a rollover precondition — those are
 * `REQ-ACTIVATE-001`, `-002` and `-003`, all three shown in the season editor's rollover panel.
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
 * One unfinished match, as the rollover panel lists it. Deliberately not the whole `FLSpiel`: the
 * joined shape would ship every referee, venue and provenance record to render a list of names.
 */
export type SaisonOffeneSpiel = {
  id: string;
  spielNr: number;
  datum: string | null;
  /** `Team A – Team B`, with a placeholder where the bracket has not filled a side yet. */
  paarung: string;
};

/** `outgoingSaisonId` is `null` when no season holds `active` — legitimate on a fresh database. */
export type SaisonRolloverContext = {
  outgoingSaisonId: string | null;
  /** Every unfinished match of the OUTGOING season. Empty when there is nothing to warn about. */
  offeneSpiele: SaisonOffeneSpiel[];
};

/**
 * What `REQ-DATE-004` leaves the season's own dates free to be, read off the matchdays that carry
 * dates. `null` at an end means nothing binds it, which is the same answer for a season holding no
 * matchday and for one whose matchdays are all undated.
 */
export type SaisonSpieltagBound = {
  /** The latest the season may start: the earliest dated matchday's `beginn`. */
  startMax: string | null;
  /** The earliest the season may end: the latest dated matchday's `ende`. */
  endMin: string | null;
};

/**
 * The generator panel's context, holding only what nothing else on the page carries: `saisonStatus`
 * comes off the season itself and `hasDrawnSpiele` is what freezes the rules panel too, so each
 * stays its own prop rather than a copy in here.
 */
export type SaisonSpielplanContext = {
  /** The season's watermark, or `null` while the generator has never run on it. */
  spielplan: FLSaisonSpielplan | null;
  /** `REQ-SPIELPLAN-002`'s condition: how many matchday rows the season holds, retired ones included. */
  spieltageCount: number;
  /**
   * The season's derived phase list, which the armed control counts its promise off. Served rather
   * than recomputed, so the panel and the endpoint cannot name different seasons.
   */
  schedule: readonly FLSaisonPhaseSchedule[];
};

/**
 * One club as it stands in THIS season. Deliberately not the whole `FLTeam`: the derived `statistik`
 * behind every team read is a table this control never draws.
 */
export type SaisonSwapTeam = {
  id: string;
  name: string;
  gruppe: FLGruppenNames;
  /**
   * `REQ-SWAP-004` counted for one club, per the season editor page's `hasTakenPlace`. Non-zero makes
   * the club unpickable: the group phase is a round robin, so it cannot leave its group.
   */
  gespielteGruppenSpiele: number;
  /** Spieltag id → this club's Gruppenphase fixtures on it. A swap MOVES every one to the other club. */
  gruppenSpieleProSpieltag: Record<string, number>;
  /**
   * Spieltag id → this club's fixtures OUTSIDE the group phase, which a swap LEAVES where they are —
   * which is what lets an exchange put a club on one Spieltag twice. `wouldFieldAClubTwice` is
   * `REQ-SWAP-005` over the two maps.
   */
  koSpieleProSpieltag: Record<string, number>;
};

/**
 * `playedKnockoutSpiele` closes the swap for good once non-zero: the bracket was seeded from these
 * groups, so any played fixture outside the Gruppenphase has already used them.
 */
export type SaisonGruppenSwapContext = {
  /** Every club entered in this season, retired ones included, ordered by name. */
  teams: SaisonSwapTeam[];
  playedKnockoutSpiele: number;
};
