import { DAY_MS, HOUR_MS } from "./timeUnits";

/** How long a session of one kind survives without use, and how long it survives at all. */
export type Lifetime = { readonly idle: number; readonly absolute: number };

// Here rather than in the sign-in library's module, which enforces them: the privacy notice states these
// figures too, and importing them from there would load Better Auth into the page.

// NIST SP 800-63B-4 §2.2.3: the overall timeout "SHOULD be no more than 24 hours at AAL2", the level a
// passkey sign-in meets. Mirrored in the backend's bounds, whose actor check refuses a token older than it.
export const ADMIN_WINDOW_HOURS = 24;

// The same section: "The inactivity timeout SHOULD be no more than 1 hour." Judged by the frontend
// alone, which holds the only record of use.
export const ADMIN_IDLE_HOURS = 1;

export const ADMIN_LIFETIME: Lifetime = { idle: ADMIN_IDLE_HOURS * HOUR_MS, absolute: ADMIN_WINDOW_HOURS * HOUR_MS };

// A person's cap, from the sign-in however recently the session was used. Mirrored in the backend's
// bounds, whose actor check refuses a person-lane token older than it.
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
