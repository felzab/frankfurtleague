import type { FLGruppenNames } from "../teams/schemas";
import type { FLSaisonBewerbung, FLSaisonPhaseSchedule, FLSaisonRules, FLSaisonSpielplan, FLSaisonStatus } from "./schemas";

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
  /**
   * `null` is the season that takes no applications at all. Its two dates are `""` while a picker
   * stands empty, which is the mid-edit state the payload schema refuses by name.
   */
  bewerbung: FLSaisonBewerbung | null;
};

export type AdminSaisonRow = {
  id: string;
  start_date: string;
  end_date: string;
  status: FLSaisonStatus;
  rules: FLSaisonRules;
};

/**
 * One unfinished match, as the rollover panel lists it. Deliberately not the whole `FLSpiel`: the
 * joined shape would ship every referee, venue and provenance record to render a list of names.
 */
export type SaisonOffeneSpiel = {
  id: string;
  spielNr: number;
  datum: string | null;
  /** The two sides joined by `gegen`, with a placeholder where the bracket has not filled one yet. */
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
 * A season's STORED draw as the generator panel weighs it: what a confirmed replace deletes, and the
 * one figure `REQ-SPIELPLAN-005` measures the offer against.
 */
export type SpielplanBestand = {
  /** How many fixtures the season holds, every phase together. */
  spiele: number;
  /**
   * How many carry something entered against them, and therefore CLOSE the replace. **Mirrors
   * `fl_backend/app/api/saisons/services.py :: holds_a_recorded_fact`**, the predicate the endpoint
   * counts `recorded_fixtures` with.
   */
  erfasst: number;
  /**
   * How many carry a date or a kickoff time. **No refusal reads this**: it is the scheduling a
   * replace throws away, which the confirmation names because nothing stops it. A venue or a referee
   * is `erfasst` instead, and stops the replace outright.
   */
  angesetzt: number;
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
  /** What a confirmed replace would destroy, and what `REQ-SPIELPLAN-005` weighs against it. */
  bestand: SpielplanBestand;
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
   * `REQ-SWAP-004` counted for one club, per
   * `fl_frontend/src/features/saisons/utils.ts :: hasTakenPlace`. Non-zero makes the club
   * unpickable: the group phase is a round robin, so it cannot leave its group.
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

/**
 * One junction row of this season, as the replacement picker offers it. Keyed by `teamId` rather
 * than by a club: a row may name a club no `teams` document resolves, and handing exactly such a
 * row on is part of what the operation is for.
 */
export type SaisonReplacementRow = {
  teamId: string;
  /** The season's copy of the name, or the fixtures' copy of it where no club read reaches the row. */
  name: string;
  /** `null` where no club read reaches the row: the group is stored on it and no fixture carries one. */
  gruppe: FLGruppenNames | null;
  /** Every fixture of this season standing on the row, each of which changes hands with it. */
  spiele: number;
  /**
   * `REQ-REPLACE-002` counted for this row, over `fl_frontend/src/features/saisons/utils.ts ::
   * hasTakenPlace` — the endpoint's own predicate. Non-zero makes the row unpickable, because the
   * record it counts would be credited to the arriving club.
   */
  gespielteSpiele: number;
  /** An `austritt` stands on the row. The replacement clears it rather than moving it. */
  hasAustritt: boolean;
  /** No `teams` document resolves `teamId`, so the club has no page this row could be reached from. */
  isVerwaist: boolean;
};

/** One club that could take a season's row over, with the two standing facts that refuse it. */
export type SaisonReplacementCandidate = {
  id: string;
  name: string;
  /** `REQ-ENTER-005`: the club left the league and enters no season until it is reactivated. */
  isStillgelegt: boolean;
  /** `REQ-REPLACE-003`: it holds a row here already — which is also how one club on both ends reads. */
  isInSaison: boolean;
};

/**
 * Both sides of the replacement panel. The rows come off this season's reads and the candidates off
 * a league-wide one, because an arriving club is by definition not in the season yet.
 */
export type SaisonReplacementContext = {
  /** Ordered by name, retired clubs and rows with no club document included. */
  rows: SaisonReplacementRow[];
  candidates: SaisonReplacementCandidate[];
};
