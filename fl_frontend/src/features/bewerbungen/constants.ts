import type {
  FLBewerbungConfirmationDeadlineDays,
  FLBewerbungKontaktMinAgeYears,
  FLSignatoryMinAgeYears,
  FLTeamShorthandLength,
} from "@/core/generated/client/types";

/**
 * A club's Kürzel is exactly this many letters. A client control cannot import the generated module that holds the
 * pattern, so a control's `maxLength` and the check of a complete code read the length from here, checked against
 * `fl_backend/app/shared/schemas/bounds.py :: TEAM_SHORTHAND_LENGTH`, so the backend moving it fails the type check here.
 */
export const SHORTHAND_LENGTH = 3 satisfies FLTeamShorthandLength;

/**
 * The floor a contact person's birthdate has to clear, checked against the bound
 * `fl_backend/app/shared/schemas/bounds.py :: BEWERBUNG_KONTAKT_MIN_AGE_YEARS` publishes, so the backend moving it
 * fails the type check here.
 */
export const BEWERBUNG_MIN_AGE = 16 satisfies FLBewerbungKontaktMinAgeYears;

/**
 * The floor the Ansprechperson and the Stellvertretung clear, checked against
 * `fl_backend/app/shared/schemas/bounds.py :: SIGNATORY_MIN_AGE_YEARS` as the contact's floor is. Those two sign what
 * binds the school, which asks contractual capacity rather than the age a person consents for themselves at.
 */
export const VERTRETUNG_MIN_AGE = 18 satisfies FLSignatoryMinAgeYears;

/**
 * The deadline a confirmation link runs on, so the page states the day the sweep deletes on; checked against
 * `fl_backend/app/shared/schemas/bounds.py :: BEWERBUNG_CONFIRMATION_DEADLINE_DAYS`, so the backend moving it fails
 * the type check here.
 */
export const BEWERBUNG_CONFIRMATION_DEADLINE_DAYS = 14 satisfies FLBewerbungConfirmationDeadlineDays;
