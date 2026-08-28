import type { FLBewerbung, FLBewerbungStatus } from "./schemas";

/** A club as the triage needs to know it, so any read carrying the two fields answers. */
export type NamedTeam = { id: string; name: string };

/**
 * One row of the triage list: the application as stored, plus the club it names resolved for
 * display. `null` where it names neither a school nor a club — the row `REQ-BEWERBUNG-002` refuses.
 */
export type AdminBewerbungRow = FLBewerbung & {
  teamName: string | null;
  // Answered against the season the header names, so the facet reading it stays a pure function of a
  // row: `fl_frontend/src/shared/utils/facets.ts :: Facet` sees nothing but the item.
  inSelectedSaison: boolean;
};

export type FLBewerbungenSortingOptions = "eingereicht_am" | "saison_id";

/**
 * What the triage list may narrow on. No `bewerbung_id`: `GET /bewerbungen/{bewerbung_id}` names one.
 *
 * Omission is meaningful: `apiClient` drops undefined params rather than serialising them, so an
 * absent `status` is every state rather than none.
 */
export type FLBewerbungenFilterParams = {
  saison_id?: string;
  status?: FLBewerbungStatus;

  limit?: number;
  sort_by?: FLBewerbungenSortingOptions;
  order?: "asc" | "desc";
};
