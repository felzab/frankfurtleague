import { rollenText } from "@/core/teamVocabulary";

import type { FLBewerbungConfirmationDeadlineDays, FLBewerbungKontaktMinAgeYears, FLSignatoryMinAgeYears } from "@/core/generated/client/types";
import type { KontaktRolle } from "@/features/teams/constants";

/**
 * A club's Kürzel is exactly this many letters, as the backend's pattern `^[A-Z]{3}$` publishes it. A client control
 * cannot import the generated module that holds the pattern, so `constants.test.ts` holds the two equal; a control's
 * `maxLength` and the check of a complete code read the length from here.
 */
export const SHORTHAND_LENGTH = 3;

/**
 * The span a contact person's birthdate has to fall in. The floor is checked against the bound
 * `fl_backend/app/shared/schemas/bounds.py :: BEWERBUNG_KONTAKT_MIN_AGE_YEARS` publishes, so the backend moving it
 * fails the type check here; the ceiling, mirrored from the same file, refuses a mistyped century rather than a real
 * age, and no other date in an application gains a bound.
 */
export const BEWERBUNG_MIN_AGE = 16 satisfies FLBewerbungKontaktMinAgeYears;
export const BEWERBUNG_MAX_AGE = 120;

/**
 * Every seat a contact person holds on one row, as the one phrase the contact page, the account page and the mails
 * name them by (`fl_frontend/src/core/teamVocabulary.ts :: rollenText`); an emptied seat names nobody.
 */
export const rollenLongForm = (rollen: readonly (KontaktRolle | null)[]): string =>
  rollenText(rollen.filter((rolle): rolle is KontaktRolle => rolle !== null));

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

/**
 * The raw token's ceiling, mirrored from `fl_backend/app/shared/schemas/bounds.py`. Bound at the two
 * consent payloads because a link mangled longer than any mint answers a `payload_refused` naming the
 * token, which no control renders, so it tells a visitor nothing about their link.
 */
export const BEWERBUNG_TOKEN_MAX_LENGTH = 128;
