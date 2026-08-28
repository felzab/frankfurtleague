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
