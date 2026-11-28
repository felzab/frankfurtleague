// A module of its own because the figures reach a client component and the privacy notice, which may
// import neither `server-only` module that enforces them.

export const SIGN_IN_CODE_LENGTH = 6;

/** How long a mailed code stands: the sign-in library expires it on this figure, and its mail states it. */
export const CODE_VALIDITY_MINUTES = 10;

/** Wrong tries one code takes before the library refuses it, a new code starting again at none. */
export const CODE_ATTEMPTS = 3;

/**
 * Failed codes one address may spend inside the window, however many codes it is sent: the plugin
 * bounds each code alone.
 */
export const CODE_FAILURE_LIMIT = 10;
export const CODE_FAILURE_WINDOW_HOURS = 24;

/** Code mails one address may be sent inside the window, so a resend cannot flood a mailbox. */
export const CODE_MAIL_LIMIT = 5;
export const CODE_MAIL_WINDOW_HOURS = 1;
