import { rollenText } from "@/core/teamVocabulary";

import type {
  FLBewerbungConfirmationDeadlineDays,
  FLBewerbungKontaktMinAgeYears,
  FLBewerbungStatus,
  FLSignatoryMinAgeYears,
} from "@/core/generated/client/types";
import type { KontaktRolle } from "@/features/teams/constants";
import type { PillTone } from "@/shared/components/ui/badges";

// Its own module and not an export of a `"use client"` view: every export of a client module becomes
// a client reference on the server side.
export const BEWERBUNGEN_CRUD_COPY = {
  searchLabel: "Bewerbungen suchen",
  searchPlaceholder: "z.B. Goethe-Gymnasium oder eine Ansprechperson",
  /** One per `fl_frontend/src/shared/components/ui/AdminCrudView.tsx :: CrudEmptiness` value: each narrowing stage asks something different of the reader. */
  emptyForQuery: "Keine Bewerbungen für diese Suche.",
  emptyForFilters: "Keine Bewerbungen für diese Filter.",
  emptyOverall: "Es sind noch keine Bewerbungen eingegangen.",
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
  { value: "submitted", label: "Eingereicht" },
  { value: "accepted", label: "Angenommen" },
  { value: "declined", label: "Abgelehnt" },
];

export function bewerbungStatusLabel(status: FLBewerbungStatus): string {
  return BEWERBUNG_STATUS_OPTIONS.find((option) => option.value === status)?.label ?? "";
}

/**
 * The tone each state wears, so the queue and the application's own page cannot read it two ways.
 * `abgelehnt` is `danger` and not `warning`: the league's Absage is final, and takes the grade a
 * seat's Widerspruch already wears.
 */
export const BEWERBUNG_STATUS_TINT: Record<FLBewerbungStatus, PillTone> = {
  submitted: "info",
  accepted: "success",
  declined: "danger",
};

/** Which of the two things an application asks the league to enter: a school it does not hold yet, or a club it does. */
export type BewerbungHerkunft = "neue_schule" | "bestehendes_team";

/** What each is called, on the queue's badge, its filter and the application's own page alike. */
export const BEWERBUNG_HERKUNFT_LABELS: Record<BewerbungHerkunft, string> = {
  neue_schule: "Neue Schule",
  bestehendes_team: "Bestehendes Team",
};

/**
 * The decline reason's bound, mirrored from `fl_backend/app/shared/schemas/bounds.py`. Every frontend
 * enforcement point reads it from here, so the schema and the input cannot disagree about the cap.
 */
export const BEWERBUNG_DECISION_REASON_MAX_LENGTH = 1000;

/**
 * A club's Kürzel is exactly this many letters, as the backend's pattern `^[A-Z]{3}$` publishes it. A client control
 * cannot import the generated module that holds the pattern, so `constants.test.ts` holds the two equal; a control's
 * `maxLength` and the check of a complete code read the length from here.
 */
export const KUERZEL_LAENGE = 3;

/**
 * The span a contact person's birthdate has to fall in. The floor is checked against the bound
 * `fl_backend/app/shared/schemas/bounds.py :: BEWERBUNG_KONTAKT_MIN_AGE_YEARS` publishes, so the backend moving it
 * fails the type check here; the ceiling, mirrored from the same file, refuses a mistyped century rather than a real
 * age, and no other date in an application gains a bound.
 */
export const BEWERBUNG_MIN_ALTER = 16 satisfies FLBewerbungKontaktMinAgeYears;
export const BEWERBUNG_MAX_ALTER = 120;

/**
 * Every seat a contact person holds on one row, as the one phrase the contact page, the account page and the mails
 * name them by (`fl_frontend/src/core/teamVocabulary.ts :: rollenText`); an emptied seat names nobody.
 */
export const rollenLangform = (rollen: readonly (KontaktRolle | null)[]): string =>
  rollenText(rollen.filter((rolle): rolle is KontaktRolle => rolle !== null));

/**
 * The floor the Ansprechperson and the Stellvertretung clear, checked against
 * `fl_backend/app/shared/schemas/bounds.py :: SIGNATORY_MIN_AGE_YEARS` as the contact's floor is. Those two sign what
 * binds the school, which asks contractual capacity rather than the age a person consents for themselves at.
 */
export const VERTRETUNG_MIN_ALTER = 18 satisfies FLSignatoryMinAgeYears;

/**
 * The deadline a confirmation link runs on, so the page states the day the sweep deletes on; checked against
 * `fl_backend/app/shared/schemas/bounds.py :: BEWERBUNG_CONFIRMATION_DEADLINE_DAYS`, so the backend moving it fails
 * the type check here.
 */
export const BEWERBUNG_BESTAETIGUNG_FRIST_TAGE = 14 satisfies FLBewerbungConfirmationDeadlineDays;

/**
 * The raw token's ceiling, mirrored from `fl_backend/app/shared/schemas/bounds.py`. Bound at the two
 * consent payloads because a link mangled longer than any mint answers a `payload_refused` naming the
 * token, which no control renders, so it tells a visitor nothing about their link.
 */
export const BEWERBUNG_TOKEN_MAX_LENGTH = 128;

/** The confirmation strip's correction press, which two refusals send the administrator to by its label: one spelling for all three. */
export const ADRESSE_KORRIGIEREN = "Adresse korrigieren";

/**
 * A re-send's answer for a seat holding no address, whether the action refuses the press or the strip closes the
 * control first: one sentence, naming the correction that stands beside the control on the strip.
 */
export const ERNEUT_OHNE_ADRESSE = `Zu dieser Rolle steht keine E-Mail-Adresse in der Bewerbung. Trage zuerst eine über „${ADRESSE_KORRIGIEREN}“ ein.`;
