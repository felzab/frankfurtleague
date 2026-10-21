/** An hour of milliseconds. */
export const HOUR_MS = 60 * 60 * 1000;

/** A day of milliseconds, with no clock change in it: two `YYYY-MM-DD` strings parse as UTC midnights, so their difference divides by it exactly. */
export const DAY_MS = 24 * HOUR_MS;
