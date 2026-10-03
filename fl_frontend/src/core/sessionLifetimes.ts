const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** How long a session of one kind survives without use, and how long it survives at all. */
export type Lifetime = { readonly idle: number; readonly absolute: number };

// Here rather than in `fl_frontend/src/core/auth.ts`, which enforces them: the privacy notice states
// these figures too, and importing them from there would load Better Auth into the page. Mirrored in
// `fl_backend/app/shared/schemas/bounds.py`, whose actor check refuses a token older than it.
export const ADMIN_WINDOW_HOURS = 48;

// ONE figure for the administrator, written into both halves below: `updatedAt` never precedes
// `createdAt`, so where the two are equal the idle comparison can never be the one that refuses.
const ADMIN_WINDOW_MS = ADMIN_WINDOW_HOURS * HOUR_MS;

export const ADMIN_LIFETIME: Lifetime = { idle: ADMIN_WINDOW_MS, absolute: ADMIN_WINDOW_MS };

// A person's cap, from the sign-in however recently the session was used. Mirrored in
// `fl_backend/app/shared/schemas/bounds.py`, whose actor check refuses a person-lane token older than it.
export const PERSON_WINDOW_DAYS = 30;

// A sliding window with no cap means a stolen cookie used weekly never expires, which is why the
// second figure is here and never redundant (`docs/frontend/spec.md :: I135`).
export const PERSON_LIFETIME: Lifetime = { idle: 14 * DAY_MS, absolute: PERSON_WINDOW_DAYS * DAY_MS };

// The library's `expiresIn` slides on every refresh, so it is an idle window and takes the longest
// one: an absolute figure here would keep a person's idle row alive past its own window.
export const SESSION_EXPIRES_IN_DAYS = Math.max(ADMIN_LIFETIME.idle, PERSON_LIFETIME.idle) / DAY_MS;

// GitHub's re-authentication window, the widely adopted figure: a change to passkeys or sign-ins asks
// again past it (`docs/frontend/spec.md :: I261`). Mirrored in `fl_backend/app/shared/schemas/bounds.py`,
// whose step-up check refuses an administrator's step-up write from a sign-in older than it.
export const STEP_UP_WINDOW_MS = 2 * HOUR_MS;

// Narrower for ADDING a passkey, which outlives the session that adds it: a borrowed session would
// otherwise leave its borrower a way in for good (`docs/frontend/spec.md :: I411`).
export const ENROLMENT_WINDOW_MS = 5 * 60 * 1000;

function isYoungerThan(createdAt: Date | string, window: number): boolean {
  const created = new Date(createdAt).getTime();

  // An unreadable stamp is no step-up rather than an unbounded one, as
  // `fl_frontend/src/core/auth.ts :: withinLifetime` reads one.
  return Number.isFinite(created) && Date.now() - created < window;
}

// Both windows' predicates beside their figures rather than in `auth.ts`: every spine judging one reads
// it here, and the suites doubling the sign-in store keep it real.
export function isWithinStepUpWindow(createdAt: Date | string): boolean {
  return isYoungerThan(createdAt, STEP_UP_WINDOW_MS);
}

/** Adding a passkey asks a sign-in or confirmation this recent, whoever adds it (`docs/frontend/spec.md :: I411`). */
export function isWithinEnrolmentWindow(createdAt: Date | string): boolean {
  return isYoungerThan(createdAt, ENROLMENT_WINDOW_MS);
}
