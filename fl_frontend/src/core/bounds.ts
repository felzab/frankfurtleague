import type {
  FLActionLogRetentionYears,
  FLAddressChangeRetentionDays,
  FLBanDurationSaisons,
  FLConfirmationDeadlineDays,
  FLDeliveryDeadlineDays,
  FLMailboxAnchorRetentionHours,
  FLMediaMinAgeYears,
  FLOutboxRetentionDays,
  FLSchiedsrichterMinAgeYears,
} from "./generated/client/types";

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

/** The age from which a person may referee for the league. */
export const SCHIEDSRICHTER_MIN_AGE = 16 satisfies FLSchiedsrichterMinAgeYears;

// The bounds below are the backend's alone, and the privacy notice states each.

/** How long the Protokoll keeps a row. */
export const ACTION_LOG_RETENTION_YEARS = 1 satisfies FLActionLogRetentionYears;

/** How long an ended address change's record stands. */
export const ADDRESS_CHANGE_RETENTION_DAYS = 30 satisfies FLAddressChangeRetentionDays;

/** How long a mailbox's pseudonymised document outlives the last press naming it. */
export const MAILBOX_ANCHOR_RETENTION_HOURS = 1 satisfies FLMailboxAnchorRetentionHours;

/** How long a mail stays queued unsent before it is given up. */
export const DELIVERY_DEADLINE_DAYS = 2 satisfies FLDeliveryDeadlineDays;

/** How long a sent or given-up mail's row stands. */
export const OUTBOX_RETENTION_DAYS = 30 satisfies FLOutboxRetentionDays;
