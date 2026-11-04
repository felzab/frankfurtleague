import { DAY_MS, HOUR_MS } from "./timeUnits";

/** How long a session of one kind survives without use, and how long it survives at all. */
export type Lifetime = { readonly idle: number; readonly absolute: number };

// Here rather than in `fl_frontend/src/core/auth.ts`, which enforces them: the privacy notice states
// these figures too, and importing them from there would load Better Auth into the page.

// NIST SP 800-63B-4 §2.2.3 (read 2026-10-15): the overall timeout "SHOULD be no more than 24 hours at
// AAL2", the level a passkey sign-in meets. Mirrored in `fl_backend/app/shared/schemas/bounds.py`, whose
// actor check refuses a token older than it.
export const ADMIN_WINDOW_HOURS = 24;

// The same section: "The inactivity timeout SHOULD be no more than 1 hour." Judged by the frontend
// alone, which holds the only record of use.
export const ADMIN_IDLE_HOURS = 1;

export const ADMIN_LIFETIME: Lifetime = { idle: ADMIN_IDLE_HOURS * HOUR_MS, absolute: ADMIN_WINDOW_HOURS * HOUR_MS };

// A person's cap, from the sign-in however recently the session was used. Mirrored in
// `fl_backend/app/shared/schemas/bounds.py`, whose actor check refuses a person-lane token older than it.
export const PERSON_WINDOW_DAYS = 30;

// A sliding window with no cap means a stolen cookie used weekly never expires, which is why the
// second figure is here and never redundant.
export const PERSON_LIFETIME: Lifetime = { idle: 14 * DAY_MS, absolute: PERSON_WINDOW_DAYS * DAY_MS };

// The library's `expiresIn` slides on every refresh, so it is an idle window and takes the longest
// one: an absolute figure here would keep a person's idle row alive past its own window.
export const SESSION_EXPIRES_IN_DAYS = Math.max(ADMIN_LIFETIME.idle, PERSON_LIFETIME.idle) / DAY_MS;

// How recent a passkey sign-in the passkey touch is: an act the touch guards asks one this recent of every person
// holding a passkey, every time.
export const PASSKEY_TOUCH_SECONDS = 60;

// Redesign: goes with its last importer.
// GitHub's re-authentication window, the widely adopted figure: a change to passkeys or sign-ins asks
// again past it. Mirrored in `fl_backend/app/shared/schemas/bounds.py`,
// whose step-up check refuses an administrator's step-up write from a sign-in older than it.
export const STEP_UP_WINDOW_MS = 2 * HOUR_MS;

// Redesign: goes with its last importer.
// Narrower for a confirmation the old account forms ask before a change to passkeys.
export const ENROLMENT_WINDOW_MS = 5 * 60 * 1000;

function isYoungerThan(createdAt: Date | string, window: number): boolean {
  const created = new Date(createdAt).getTime();

  // An unreadable stamp is no step-up rather than an unbounded one, as
  // `fl_frontend/src/core/auth.ts :: withinLifetime` reads one.
  return Number.isFinite(created) && Date.now() - created < window;
}

// Redesign: goes with its last importer.
// Both windows' predicates beside their figures rather than in `auth.ts`: every spine judging one reads
// it here, and the suites doubling the sign-in store keep it real.
export function isWithinStepUpWindow(createdAt: Date | string): boolean {
  return isYoungerThan(createdAt, STEP_UP_WINDOW_MS);
}

// Redesign: goes with its last importer.
/** The old account forms' confirmation before a change to passkeys asks a sign-in this recent. */
export function isWithinEnrolmentWindow(createdAt: Date | string): boolean {
  return isYoungerThan(createdAt, ENROLMENT_WINDOW_MS);
}
