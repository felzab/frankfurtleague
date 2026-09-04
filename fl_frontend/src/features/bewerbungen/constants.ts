import { KONTAKT_ROLLEN } from "@/features/teams/constants";

import type { FLBewerbungStatus } from "./schemas";

// Its own module and not an export of a `"use client"` view: every export of a client module becomes
// a client reference on the server side.
export const BEWERBUNGEN_CRUD_COPY = {
  searchLabel: "Bewerbungen suchen",
  searchPlaceholder: "z.B. Goethe-Gymnasium oder eine Ansprechperson",
} as const;

type BewerbungStatusOption = {
  readonly value: FLBewerbungStatus;
  /** Names the application's STATE, for a badge and for the triage's filter alike. */
  readonly label: string;
};

/**
 * The states an application stands in, in the order the triage works them down. Every wording lives
 * here as one fact, so no two surfaces can name one state differently.
 */
export const BEWERBUNG_STATUS_OPTIONS: readonly BewerbungStatusOption[] = [
  { value: "eingereicht", label: "Eingereicht" },
  { value: "angenommen", label: "Angenommen" },
  { value: "abgelehnt", label: "Abgelehnt" },
];

export function bewerbungStatusLabel(status: FLBewerbungStatus): string {
  return BEWERBUNG_STATUS_OPTIONS.find((option) => option.value === status)?.label ?? "";
}

/**
 * The tint each state wears beside its label, so a badge cannot read one way in the list and another
 * on the application's own page. `abgelehnt` is neutral rather than red: a decline is a decision the
 * league took, not a fault anybody has to act on.
 */
export const BEWERBUNG_STATUS_TINT: Record<FLBewerbungStatus, string> = {
  eingereicht: "bg-info/15 text-info-strong",
  angenommen: "bg-success/15 text-success-strong",
  abgelehnt: "bg-muted text-foreground-muted",
};

/**
 * The decline reason's bound, mirrored from `fl_backend/app/shared/schemas/bounds.py`. Every frontend
 * enforcement point reads it from here, so the schema and the input cannot disagree about the cap.
 */
export const BEWERBUNG_GRUND_MAX_LENGTH = 1000;

/**
 * A club's Kürzel is exactly this many characters. Read by the schema, the input's own cap and the
 * blur-time check, so no two of them can disagree about what a complete code looks like.
 */
export const KUERZEL_LAENGE = 2;

/**
 * The submission's own ceilings, mirrored from `fl_backend/app/shared/schemas/bounds.py`. Bound here too because
 * the public endpoint refuses a length with a bare `REQ-VAL-001` and no field detail, so nothing marks the box.
 */
export const BEWERBUNG_TRIKOT_SATZ_MAX_LENGTH = 500;
export const BEWERBUNG_KADER_GROESSE_MAX = 200;
// `TEAM_FULL_NAME_MAX_LENGTH`'s width rather than the team name's: nothing holds an applicant to
// the league's short name, so what they type is a school's own name.
export const BEWERBUNG_WUNSCHGEGNER_MAX_LENGTH = 120;

/**
 * The span a contact person's birthdate has to fall in, mirrored from
 * `fl_backend/app/shared/schemas/bounds.py`. The ceiling refuses a mistyped century rather than a
 * real age, and no other date in an application gains a bound.
 */
export const BEWERBUNG_MIN_ALTER = 16;
export const BEWERBUNG_MAX_ALTER = 120;

/**
 * The picker key standing for „meine Schule ist nicht dabei“.
 *
 * **Not an ObjectId and never one**: every other key in that list is a club id, so a sentinel that
 * could be mistaken for one would submit as `team_id` and name a club nobody picked.
 */
export const SCHULE_NICHT_IN_LISTE = "neue-schule";

/** What that option reads as, in the trigger as well as in the list — one string, so the two agree. */
export const SCHULE_NICHT_IN_LISTE_LABEL = "Meine Schule steht nicht in der Liste";

/**
 * `KONTAKT_ROLLEN` under its long wording, never a second table: two lists of one set drift, and the
 * triage panel reads one while this form reads the other.
 */
export const BEWERBUNG_SEATS = KONTAKT_ROLLEN.map(({ value, langform }) => ({ value: value, label: langform }));
