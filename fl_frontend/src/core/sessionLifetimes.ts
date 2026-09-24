const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** How long a session of one kind survives without use, and how long it survives at all. */
export type Lifetime = { readonly idle: number; readonly absolute: number };

// Here rather than in `fl_frontend/src/core/auth.ts`, which enforces them: the privacy notice states
// these figures too, and importing them from there would load Better Auth into the page.
export const ADMIN_WINDOW_HOURS = 48;

// ONE figure for the administrator, written into both halves below: `updatedAt` never precedes
// `createdAt`, so where the two are equal the idle comparison can never be the one that refuses.
export const ADMIN_WINDOW_MS = ADMIN_WINDOW_HOURS * HOUR_MS;

export const ADMIN_LIFETIME: Lifetime = { idle: ADMIN_WINDOW_MS, absolute: ADMIN_WINDOW_MS };

// A sliding window with no cap means a stolen cookie used weekly never expires, which is why the
// second figure is here and never redundant (`docs/frontend/spec.md :: I135`).
export const PERSON_LIFETIME: Lifetime = { idle: 30 * DAY_MS, absolute: 90 * DAY_MS };

// Derived, never typed a fifth time: the library configures one lifetime for everybody, so it gets
// the longest and `fl_frontend/src/core/auth.ts :: withinLifetime` refuses the rest per request.
export const SESSION_EXPIRES_IN_DAYS =
  Math.max(ADMIN_LIFETIME.idle, ADMIN_LIFETIME.absolute, PERSON_LIFETIME.idle, PERSON_LIFETIME.absolute) / DAY_MS;
