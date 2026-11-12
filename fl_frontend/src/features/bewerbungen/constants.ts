import type {
  FLBewerbungConfirmationDeadlineDays,
  FLBewerbungKontaktMinAgeYears,
  FLSignatoryMinAgeYears,
  FLTeamShorthandLength,
} from "@/core/generated/client/types";

/**
 * A client control cannot import the generated module that holds the pattern, so a control's `maxLength` and the check
 * of a complete code read the length from here.
 */
export const SHORTHAND_LENGTH = 3 satisfies FLTeamShorthandLength;

/** The floor a contact person's birthdate has to clear. */
export const BEWERBUNG_MIN_AGE = 16 satisfies FLBewerbungKontaktMinAgeYears;

/**
 * The floor the Ansprechperson and the Stellvertretung clear. Those two sign what binds the school, which asks
 * contractual capacity rather than the age a person consents for themselves at.
 */
export const SIGNATORY_MIN_AGE = 18 satisfies FLSignatoryMinAgeYears;

/** The deadline a confirmation link runs on, so the page states the day the sweep deletes on. */
export const BEWERBUNG_CONFIRMATION_DEADLINE_DAYS = 14 satisfies FLBewerbungConfirmationDeadlineDays;
