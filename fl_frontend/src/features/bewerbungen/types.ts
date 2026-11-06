import type {
  FLBewerbung,
  FLBewerbungEinwilligungViewResponse,
  FLBewerbungEinwilligungViewResponseQuelle,
} from "@/core/generated/client/types";

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

/**
 * An application's `abgelaufen` and `ungueltig` render one wording, since telling them apart tells a
 * guessed link that a record once existed; a season row's spent link is worded for the row its read named.
 */
export type LinkZustand = "confirmed" | "declined" | "expired" | "invalid" | "barred";

/**
 * A spent link keeps the record it opened where the read answered one, so its panel says what is true of
 * that record; a link opening nothing names none.
 */
export type EinwilligungAnsicht =
  // One member per open state, so a check of `zustand` narrows to the one the caller handles.
  | { zustand: "valid"; ansicht: FLBewerbungEinwilligungViewResponse }
  | { zustand: "saison_past"; ansicht: FLBewerbungEinwilligungViewResponse }
  | { zustand: LinkZustand; quelle?: FLBewerbungEinwilligungViewResponseQuelle };
