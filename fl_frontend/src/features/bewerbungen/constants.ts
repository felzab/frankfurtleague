import { rollenText } from "@/core/teamVocabulary";
import { KONTAKT_ROLLEN } from "@/features/teams/constants";

import type { FLBewerbungConfirmationDeadlineDays, FLBewerbungKontaktMinAgeYears, FLSignatoryMinAgeYears } from "@/core/generated/client/types";
import type { KontaktRolle } from "@/features/teams/constants";

/**
 * A club's Kürzel is exactly this many letters, as the backend's pattern `^[A-Z]{3}$` publishes it. A client control
 * cannot import the generated module that holds the pattern, so `constants.test.ts` holds the two equal; a control's
 * `maxLength` and the check of a complete code read the length from here.
 */
export const KUERZEL_LAENGE = 3;

/**
 * The submission's own ceilings, mirrored from `fl_backend/app/shared/schemas/bounds.py`. Bound here too because
 * the public endpoint's `payload_refused` marks an over-long box with a generic sentence rather than the bound's German.
 */
export const BEWERBUNG_TRIKOT_SATZ_MAX_LENGTH = 500;
export const BEWERBUNG_KADER_GROESSE_MAX = 200;
// `TEAM_FULL_NAME_MAX_LENGTH`'s width rather than the team name's: nothing holds an applicant to
// the league's short name, so what they type is a school's own name.
export const BEWERBUNG_WUNSCHGEGNER_MAX_LENGTH = 120;

/**
 * How many pupils one Abi-Jahrgang holds, the ones who never play included, mirrored from
 * `fl_backend/app/shared/schemas/bounds.py`. A ceiling against a slipped digit rather than against a
 * real cohort: no school in the league fields an Abi-Jahrgang this size.
 */
export const BEWERBUNG_STUFENGROESSE_MAX = 999;

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
