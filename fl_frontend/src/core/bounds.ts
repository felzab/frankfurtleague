import type { FLBanDurationSaisons, FLConfirmationDeadlineDays, FLMediaMinAgeYears } from "./generated/client/types";

/**
 * The age from which a person may switch the media consent on, pupils, referees and contact seats alike. Each bound
 * here `satisfies` the one the backend publishes, so the backend moving it fails the type check here.
 */
export const MEDIA_MIN_AGE = 18 satisfies FLMediaMinAgeYears;

/**
 * The days every confirmation link answers, an application's seat, a registration and a referee's entry alike, and the
 * days a declined application or registration stands before its sweep deletes it.
 */
export const CONFIRMATION_DEADLINE_DAYS = 14 satisfies FLConfirmationDeadlineDays;

/** How many seasons a ban runs after its own: the ban list's dialog and the privacy notice state it. */
export const BAN_DURATION_SAISONS = 5 satisfies FLBanDurationSaisons;
