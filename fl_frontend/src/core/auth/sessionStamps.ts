import "server-only";

import { now } from "../clock";
import { isWithinStepUpWindow, PASSKEY_TOUCH_SECONDS, PERSON_LIFETIME } from "../sessionLifetimes";

import type { Lifetime } from "../sessionLifetimes";

// The library's `freshAge`, which it holds both halves of a passkey enrolment to, measured from `createdAt`: a passkey
// outlives the session adding it, so a session borrowed for longer than this adds none.
export const FRESH_SIGN_IN_SECONDS = 5 * 60;

/** What made a session, stamped on its row and read by every guard. */
export const PASSKEY_FACTOR = "passkey";

/** A code mailed to the address: whoever holds the mailbox holds this factor. */
export const CODE_FACTOR = "code";

export type AuthFactor = typeof PASSKEY_FACTOR | typeof CODE_FACTOR;

/** The session field naming, by `lineageOf`, the session a sign-in replaced. */
export const REPLACED_SESSION_FIELD = "replacedSession";

/** The account field holding when its sessions were last ended: every session made at or before it is no session. */
export const SESSIONS_ENDED_FIELD = "sessionsEndedAt";

/** As much of a session as the passkey touch judges: when it was made, and by which factor. */
export type SessionStamps = { readonly createdAt: Date | string; readonly authFactor?: unknown };

/** As much of a served session as the step-up judges, beside whether its address holds a grant. */
type StepUpCaller = {
  readonly user: { readonly email: string };
  readonly session: SessionStamps;
  readonly verwaltung: boolean;
};

// Redesign: goes with its last importer.
/**
 * Whether a session was signed in -- or confirmed, which mints a new one -- recently enough to change
 * passkeys and sign-ins: by either factor for a person, by the passkey for an administrator.
 */
export function isFreshlySignedIn(served: StepUpCaller): boolean {
  if (!isWithinStepUpWindow(served.session.createdAt)) return false;

  return !served.verwaltung || served.session.authFactor === PASSKEY_FACTOR;
}

/**
 * Whether a session is the passkey touch as of `at`, now unless a caller judges an earlier moment: made by a passkey
 * sign-in no longer than `PASSKEY_TOUCH_SECONDS` before it, and not after it.
 */
export function isPasskeyTouch(session: SessionStamps, at: Date = now()): boolean {
  const created = new Date(session.createdAt).getTime();
  const elapsed = at.getTime() - created;
  // An unreadable stamp is no touch, as `withinLifetime` reads one.
  return session.authFactor === PASSKEY_FACTOR && Number.isFinite(elapsed) && elapsed >= 0 && elapsed < PASSKEY_TOUCH_SECONDS * 1000;
}

/**
 * The stamps sit on the stored row and on neither arm's declared type, the library typing both to
 * its own base shape: read through `Reflect` rather than cast, so nothing here claims they are there.
 */
export function stampsOf(session: object): SessionStamps {
  return { createdAt: Reflect.get(session, "createdAt") as Date | string, authFactor: Reflect.get(session, "authFactor") };
}

/**
 * Whether the account's sessions were ended at or after this one was made, whatever deleted or kept its
 * row.
 */
export function endedByItsAccount({ user, session }: { user: object; session: object }): boolean {
  // Through `Reflect`, as `stampsOf` reads a stamp: the library types a ceremony's read to its own base shape.
  const stamp: unknown = Reflect.get(user, SESSIONS_ENDED_FIELD);
  if (stamp === null || stamp === undefined) return false;

  const created = new Date(Reflect.get(session, "createdAt") as Date | string).getTime();
  const ended = new Date(stamp as Date | string).getTime();

  // An unreadable instant on either side serves nothing, as `withinLifetime` reads an unreadable stamp.
  return !Number.isFinite(created) || !Number.isFinite(ended) || created <= ended;
}

export function withinLifetime(session: { createdAt: Date; updatedAt: Date }, lifetime: Lifetime): boolean {
  // Re-read through `Date` rather than trusting the declared type: what reaches here is whatever
  // the adapter deserialised, and a string carries no `getTime` at all.
  const created = new Date(session.createdAt).getTime();
  const updated = new Date(session.updatedAt).getTime();

  // An unreadable stamp is no session rather than an unbounded one. Stated rather than left to
  // NaN's own answer, which the next comparison added here would not inherit.
  if (!Number.isFinite(created) || !Number.isFinite(updated)) return false;

  const at = now().getTime();
  return at - updated < lifetime.idle && at - created < lifetime.absolute;
}

/** Exported for `fl_frontend/src/core/subject.ts`, which judges the same window in its own lane. */
export function isWithinPersonLifetime(session: { createdAt: Date; updatedAt: Date }): boolean {
  return withinLifetime(session, PERSON_LIFETIME);
}
