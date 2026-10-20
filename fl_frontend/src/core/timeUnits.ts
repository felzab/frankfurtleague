/** A day of milliseconds, with no clock change in it: two `YYYY-MM-DD` strings parse as UTC midnights, so their difference divides by it exactly. */
export const DAY_MS = 24 * 60 * 60 * 1000;
