import type { FLDeclinedRetentionDays, FLMediaMinAgeYears, FLRegistrierungConfirmationDeadlineDays } from "./generated/client/types";

/**
 * The age from which a person may switch the media consent on, pupils, referees and contact seats alike, for the pages
 * and the published notice; checked against the bound `fl_backend/app/shared/schemas/bounds.py :: MEDIA_MIN_AGE_YEARS`
 * publishes, so the backend moving it fails the type check here.
 */
export const MEDIA_MIN_AGE = 18 satisfies FLMediaMinAgeYears;

/**
 * How long a registration waits for its confirmation, as the mail and the notice state it; checked against
 * `fl_backend/app/shared/schemas/bounds.py :: REGISTRIERUNG_CONFIRMATION_DEADLINE_DAYS` as the media floor is.
 */
export const REGISTRIERUNG_CONFIRMATION_DEADLINE_DAYS = 14 satisfies FLRegistrierungConfirmationDeadlineDays;

/**
 * The days a declined application or registration stands before its sweep deletes it, as the two refusals' mails and
 * the notice state it; checked against `fl_backend/app/shared/schemas/bounds.py :: DECLINED_RETENTION_DAYS` as the
 * media floor is.
 */
export const DECLINED_RETENTION_DAYS = 14 satisfies FLDeclinedRetentionDays;
