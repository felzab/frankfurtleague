import "server-only";

import { cache } from "react";

import { asSignInIdentifier } from "../emailAddress";
import { madeSince } from "../grant";
import { judgedOncePerRequest, setRequestActor } from "../requestScope";
import { ADMIN_LIFETIME } from "../sessionLifetimes";
import { lookUpSubject } from "../signInGate";
import { subjectOrNull } from "./gateReads";
import { readRequestSession } from "./session";
import { CODE_FACTOR, isPasskeyTouch, isWithinPersonLifetime, PASSKEY_FACTOR, withinLifetime } from "./sessionStamps";

import type { Grant } from "../grant";
import type { ActorLane, RequestActor } from "../requestScope";
import type { ServedSession } from "./session";

/**
 * Whether the request's actor may make an act the passkey touch guards: an actor of an address holding a grant on a
 * session the touch made within its window alone, and one of an address holding none as they stand. `granted` is the
 * grant this request read for the actor's address, and the touch's whole strength for an administrator's Konto act
 * rests on it: the account's guard reads it on every request and throws on an unread one rather than answering none.
 * The browser asks the touch on every final press, so a second act inside one window is a request no page sends.
 * `false` where no guard recorded an actor.
 */
export function passesPasskeyTouch(actor: RequestActor | undefined, granted: boolean): boolean {
  if (actor === undefined) return false;
  if (!granted) return true;
  return isPasskeyTouch({ createdAt: new Date(actor.authTime * 1000), authFactor: actor.factor });
}

/**
 * The account's own guard, for Konto's pages and its acts' lane, over the served session: an address holding a grant
 * is admitted by the administrator's verdict alone, so a session its mailbox made changes nothing of that
 * administrator's sign-in, its passkeys and its other devices among it. React's `cache`, so a page's boxes share one
 * verdict, and no request another's; a server action runs outside a render, where it memoises nothing, and asks it
 * once in its lane.
 */
export const getAccountSession = cache(async (): Promise<JudgedSession | null> => {
  const served = await readRequestSession();
  if (served === null) return null;

  // An unread grant throws rather than falling to the person's lane, which takes a mailed code. The
  // grant comes in this one lookup, which the person guard of a render shares.
  const subject = await lookUpSubject(asSignInIdentifier(served.user.email));

  const judged = { ...served, isAdmin: subject.admin_tier !== null };
  if (judged.isAdmin) return isAdminSession(served, subject) ? judged : null;

  return isWithinPersonLifetime(served.session) ? judged : null;
});

/**
 * A served session beside the verdict on the grant this request read for its address.
 * Held for the request alone: a stamp on the stored row would outlive a revoke made in the database.
 */
export type JudgedSession = ServedSession & { readonly isAdmin: boolean };

export function isAdminWithinWindow(served: ServedSession): boolean {
  // A refreshed `updatedAt` shows none of the idle gap before it, and the mark does.
  return served.session.adminLapsed !== true && withinLifetime(served.session, ADMIN_LIFETIME);
}

/**
 * Whether this served session may act as an administrator — its address holding a grant it was made
 * since, inside both of the administrator's figures, and made by the passkey rather than by a mailed code alone.
 */
export function isAdminSession(served: ServedSession, { admin_tier, granted_since }: Grant): boolean {
  // A passkey enrolled before the grant still admits, on a sign-in after it: the grant is the privilege,
  // and a passkey the factor it asks, enrolled on the mailbox's own authority.
  return (
    admin_tier !== null &&
    madeSince(served.session.createdAt, granted_since) &&
    isAdminWithinWindow(served) &&
    served.session.authFactor === PASSKEY_FACTOR
  );
}

/**
 * Why the administrator's guard turned a request away, by what repairs it: a sign-in for `signIn`; no
 * caller for `noGrant`; the backend for `unread`.
 */
export type AdminRefusal = "signIn" | "noGrant" | "unread";

/**
 * The actor a guard records for this request, as the backend reads it beside the admin key. `null`
 * where the session cannot be stated truthfully: an unreadable creation stamp, or a factor this league
 * does not mint; the guard then answers no session.
 */
export function requestActorOf(
  served: { readonly user: { readonly email: string }; readonly session: { readonly createdAt: Date | string; readonly authFactor?: unknown } },
  lane: ActorLane,
): RequestActor | null {
  const email = asSignInIdentifier(served.user.email);
  const authTime = Math.floor(new Date(served.session.createdAt).getTime() / 1000);
  const factor = served.session.authFactor;

  if (!Number.isFinite(authTime)) return null;
  if (factor !== PASSKEY_FACTOR && factor !== CODE_FACTOR) return null;

  return { email, lane, authTime, factor };
}

/** The administrator's guard's judgement of one request: the session and the actor it states, or why it was refused. */
export type AdminJudgement = { readonly session: JudgedSession; readonly actor: RequestActor } | { readonly refused: AdminRefusal };

async function judgeAdmin(): Promise<AdminJudgement> {
  const served = await readRequestSession();
  if (!served) return { refused: "signIn" };

  // An unread grant admits nobody, so the administration is shut while the backend is.
  const records = await subjectOrNull(served.user.email);
  if (records === null) return { refused: "unread" };
  if (records.admin_tier === null) return { refused: "noGrant" };
  // A session made before its grant among them, which a sign-in after the grant repairs.
  if (!isAdminSession(served, records)) return { refused: "signIn" };

  // A session no actor can state truthfully is repaired by signing in afresh.
  const actor = requestActorOf(served, "admin");
  if (actor === null) return { refused: "signIn" };

  return { session: { ...served, isAdmin: true }, actor };
}

// React's `cache` within a render and the request scope's held judgement within an action, so one request reads its
// session once.
const readAdminRequest = cache(() => judgedOncePerRequest(judgeAdmin));

export async function judgeAdminRequest(): Promise<{ readonly session: JudgedSession } | { readonly refused: AdminRefusal }> {
  const judged = await readAdminRequest();
  if ("refused" in judged) return judged;

  // On every call, outside the held judgement: a render's first read may precede every scope, and a later
  // scope answered from it would name nobody. The ordering is load-bearing.
  setRequestActor(judged.actor);

  return { session: judged.session };
}

export async function getAdminSession(): Promise<JudgedSession | null> {
  const judged = await judgeAdminRequest();
  return "session" in judged ? judged.session : null;
}

/**
 * The address an administration page was drawn for, which its acts behind the passkey touch post, since an acting
 * administrator signs in by passkey alone. Empty for a refused session rather than a throw: the page's own guard turns
 * that one away to the sign-in, and a throw racing it would show an error page in its place.
 */
export async function getAdminHolder(): Promise<string> {
  return (await getAdminSession())?.user.email ?? "";
}
