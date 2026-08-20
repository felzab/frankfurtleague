import type { FLAustrittType, FLGruppenNames } from "./schemas";

export const TEAMS_CRUD_COPY = {
  searchLabel: "Teams suchen",
  searchPlaceholder: "Suchen nach Name oder Kürzel...",
} as const;

/** In the order every picker offers them. The closed set is `FLGruppenNames`'s. */
export const GRUPPEN_OPTIONS: readonly FLGruppenNames[] = ["A", "B", "C", "D"];

type AustrittOption = {
  readonly value: FLAustrittType;
  /** Names the RECORD, for the editor's picker and the change list. */
  readonly label: string;
  /** Names the CLUB's resulting state, for anything reading `… seit <Datum>`. */
  readonly zustand: string;
  /** The two-letter badge a table cell and the team popover have room for. */
  readonly kuerzel: string;
};

/**
 * The two routes out of a season, in the editor's order.
 *
 * All three wordings live here as one fact: a surface reads them rather than writing its own
 * German, so no two can name the same record differently — a withdrawal reading as a sanction.
 */
export const AUSTRITT_OPTIONS: readonly AustrittOption[] = [
  { value: "disqualifikation", label: "Disqualifikation", zustand: "Disqualifiziert", kuerzel: "DQ" },
  { value: "rueckzug", label: "Rückzug", zustand: "Zurückgezogen", kuerzel: "RZ" },
];

// The find cannot miss: `type` is the closed set the table enumerates, and the parse refuses
// anything else before a render sees it.
const austrittOption = (type: FLAustrittType): AustrittOption | undefined => AUSTRITT_OPTIONS.find((option) => option.value === type);

/** The state a club is in once the record exists — `Disqualifiziert seit …`, `Zurückgezogen seit …`. */
export function austrittZustand(type: FLAustrittType): string {
  return austrittOption(type)?.zustand ?? "";
}

/** The badge form. Always rendered beside the full `zustand` as a label, so the two letters never stand alone. */
export function austrittKuerzel(type: FLAustrittType): string {
  return austrittOption(type)?.kuerzel ?? "";
}

/**
 * The description's bound, mirrored from the backend models, which each spell it as a literal.
 * Every frontend enforcement point reads it from here, so no two can disagree about the cap.
 */
export const DESCRIPTION_MAX_LENGTH = 4096;
