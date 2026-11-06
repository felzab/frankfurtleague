import type { FLBewerbung } from "@/core/generated/client/types";

/** A club as the triage needs to know it, so any read carrying the two fields answers. */
export type NamedTeam = { id: string; name: string };

/**
 * One row of the triage list: the application as stored, plus the club it names resolved for
 * display. `null` where it names neither a school nor a club — the row `bewerbung_subject_unresolved` refuses.
 */
export type AdminBewerbungRow = FLBewerbung & {
  teamName: string | null;
  // Answered against the season the header names, so the facet reading it stays a pure function of a
  // row: `fl_frontend/src/shared/utils/facets.ts :: Facet` sees nothing but the item.
  inSelectedSaison: boolean;
};
