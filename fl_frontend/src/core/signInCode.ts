// A module of its own because the figures reach a client component and the privacy notice, which may
// import neither `server-only` module that enforces them.

/** Digits in a mailed sign-in code: `fl_frontend/src/core/auth.ts` mints them, the field takes them, the route parses them. */
export const SIGN_IN_CODE_LENGTH = 6;

/**
 * Failed codes one address may spend inside the window, however many codes it is sent: the plugin
 * bounds each code alone (`docs/frontend/spec.md :: I441`).
 */
export const CODE_FAILURE_LIMIT = 10;
export const CODE_FAILURE_WINDOW_HOURS = 24;

/** Code mails one address may be sent inside the window, so a resend cannot flood a mailbox (`docs/frontend/spec.md :: I442`). */
export const CODE_MAIL_LIMIT = 5;
export const CODE_MAIL_WINDOW_HOURS = 1;
