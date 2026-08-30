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
 * The three states an application stands in, in the order the triage works them down. All three
 * wordings live here as one fact, so no two surfaces can name one state differently.
 */
export const BEWERBUNG_STATUS_OPTIONS: readonly BewerbungStatusOption[] = [
  { value: "eingereicht", label: "Eingereicht" },
  { value: "angenommen", label: "Angenommen" },
  { value: "abgelehnt", label: "Abgelehnt" },
];

/** What every surface renders for a stored status. */
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
 * The span a contact person's birthdate has to fall in, bound on the PUBLIC payload alone: a date
 * outside it is a typo rather than a person, and no other date in an application gains a bound.
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
 * The three seats the public form asks for, in the order it asks.
 *
 * The label alone: what each seat is for is a `Hint` on its own panel, written there as a literal
 * because `hintCap.test.ts` counts a body it can read and nothing a component interpolates.
 */
export const BEWERBUNG_SEATS = [
  { value: "trainer", label: "Trainerin oder Trainer" },
  { value: "ansprechperson", label: "Ansprechperson" },
  { value: "stellvertretung", label: "Stellvertretung" },
] as const;
