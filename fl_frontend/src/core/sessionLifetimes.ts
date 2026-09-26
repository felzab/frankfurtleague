const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** How long a session of one kind survives without use, and how long it survives at all. */
export type Lifetime = { readonly idle: number; readonly absolute: number };

// Here rather than in `fl_frontend/src/core/auth.ts`, which enforces them: the privacy notice states
// these figures too, and importing them from there would load Better Auth into the page.
export const ADMIN_WINDOW_HOURS = 48;

// ONE figure for the administrator, written into both halves below: `updatedAt` never precedes
// `createdAt`, so where the two are equal the idle comparison can never be the one that refuses.
const ADMIN_WINDOW_MS = ADMIN_WINDOW_HOURS * HOUR_MS;

export const ADMIN_LIFETIME: Lifetime = { idle: ADMIN_WINDOW_MS, absolute: ADMIN_WINDOW_MS };

// A sliding window with no cap means a stolen cookie used weekly never expires, which is why the
// second figure is here and never redundant (`docs/frontend/spec.md :: I135`).
export const PERSON_LIFETIME: Lifetime = { idle: 14 * DAY_MS, absolute: 30 * DAY_MS };

// The library's `expiresIn` slides on every refresh, so it is an idle window and takes the longest
// one: an absolute figure here would keep a person's idle row alive past its own window.
export const SESSION_EXPIRES_IN_DAYS = Math.max(ADMIN_LIFETIME.idle, PERSON_LIFETIME.idle) / DAY_MS;

// GitHub's re-authentication window, the widely adopted figure: a change to passkeys or sign-ins asks
// again past it (`docs/frontend/spec.md :: I261`).
export const STEP_UP_WINDOW_MS = 2 * HOUR_MS;
