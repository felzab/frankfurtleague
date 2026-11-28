export const SECOND_MS = 1000;
export const MINUTE_MS = 60 * SECOND_MS;
export const HOUR_MS = 60 * MINUTE_MS;

/** A day of milliseconds, with no clock change in it: two `YYYY-MM-DD` strings parse as UTC midnights, so their difference divides by it exactly. */
export const DAY_MS = 24 * HOUR_MS;
