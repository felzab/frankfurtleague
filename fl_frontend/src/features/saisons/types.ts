/**
 * SAISONS · query parameter types and the admin surfaces' assembled shapes
 *
 * Outbound query shapes, not validation — inbound data is validated by `schemas.ts`.
 *
 * Note `sort_by: "_id"` sorts by the season id, which is the four-character year string, so it sorts
 * chronologically. That is a property of the id format, not a coincidence.
 */

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
 * `status` is absent, and it is absent from the payload schemas for the same reason (ADR-0033): the
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
 * `spieleOhneErgebnis` is what makes the list readable as a rollover surface: it is how many of the
 * season's matches carry no result, which is the precondition the rollover control presents rather
 * than enforces (ADR-0033), and a season with an outstanding count is one whose rollover deserves a
 * second look.
 */
export type AdminSaisonRow = {
  id: string;
  start_date: string;
  end_date: string;
  status: FLSaisonStatus;
  rules: FLSaisonRules;
  /** How many matchdays this season has, retired ones included. */
  spieltageCount: number;
  /** How many teams hold a junction row for this season. */
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
