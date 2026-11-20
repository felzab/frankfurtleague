import type { FLBewerbungKontaktMinAgeYears, FLSignatoryMinAgeYears } from "@/core/generated/client/types";

/** The floor a contact person's birthdate has to clear. */
export const BEWERBUNG_MIN_AGE = 16 satisfies FLBewerbungKontaktMinAgeYears;

/**
 * The floor the Ansprechperson and the Stellvertretung clear. Those two sign what binds the school, which asks
 * contractual capacity rather than the age a person consents for themselves at.
 */
export const SIGNATORY_MIN_AGE = 18 satisfies FLSignatoryMinAgeYears;
