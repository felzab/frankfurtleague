import "server-only";

import { cache } from "react";

import { asSignInIdentifier } from "../emailAddress";
import { oncePerRequest, setRequestActor } from "../requestScope";
import { ADMIN_LIFETIME } from "../sessionLifetimes";
import { lookUpSubjekt } from "../signInGate";
import { madeSince } from "../verwaltung";
import { verwaltungOrNull } from "./gateReads";
import { auth } from "./library";
import { readRequestSession } from "./session";
import { CODE_FACTOR, isPasskeyTouch, isWithinPersonLifetime, PASSKEY_FACTOR, withinLifetime } from "./sessionStamps";

import type { ActorLane, RequestActor } from "../requestScope";
import type { Verwaltung } from "../verwaltung";
import type { ServedSession } from "./session";

/**
 * Whether the request's actor may make an act the passkey touch guards: a person holding a passkey by the touch
 * alone, every time, and a person holding none as they stand. `false` where no guard recorded an actor.
 */
export async function passesPasskeyTouch(actor: RequestActor | undefined): Promise<boolean> {
  if (actor === undefined) return false;
  if (isPasskeyTouch({ createdAt: new Date(actor.authTime * 1000), authFactor: actor.factor })) return true;
  // Every guard serves a passkey's session only while its passkey is held, so one past the touch is a holder's.
  if (actor.factor === PASSKEY_FACTOR) return false;

  const { adapter, internalAdapter } = await auth.$context;
  const account = await internalAdapter.findUserByEmail(actor.email);
  // No account at the actor's address is no session to judge, so nothing passes.
  if (account === null) return false;
  return (await adapter.count({ model: "passkey", where: [{ field: "userId", value: account.user.id }] })) === 0;
}

// React's `cache`: the page's sections share one verdict, and no request another's. A server action
// runs outside a render and asks it once, through `runKontoMutation`.
/**
 * The account page's guard, both lanes' own verdict on the served session: an address holding a grant
 * is admitted by the administrator's guard alone, so a session its mailbox made cannot manage that
 * administrator's passkeys.
 */
export const getKontoSession = cache(async (): Promise<JudgedSession | null> => {
  const served = await readRequestSession();
  if (served === null) return null;

  // An unread grant throws rather than falling to the person's lane, which takes a mailed code. The
  // ban and the grant come in this one lookup, which the person guard of a render shares.
  const subjekt = await lookUpSubjekt(asSignInIdentifier(served.user.email));

  // On every request, as the person guard's: a session its ban's ending missed is no session here.
  if (subjekt.barred) return null;

  const judged = { ...served, verwaltung: subjekt.verwaltung !== null };
  if (judged.verwaltung) return isAdminSession(served, subjekt) ? judged : null;

  return isWithinPersonLifetime(served.session) ? judged : null;
});

/**
 * A served session beside the grant this request read for its address, which a step-up judges it by.
 * Held for the request alone: a stamp on the stored row would outlive a revoke made in the database.
 */
type JudgedSession = ServedSession & { readonly verwaltung: boolean };

export function isAdminWithinWindow(served: ServedSession): boolean {
  // A refreshed `updatedAt` shows none of the idle gap before it, and the mark does.
  return served.session.adminLapsed !== true && withinLifetime(served.session, ADMIN_LIFETIME);
}

/** Every administrator's condition the grant itself does not decide: a passkey session inside both of the administrator's figures. */
function passesButForItsGrant(served: ServedSession): boolean {
  return isAdminWithinWindow(served) && served.session.authFactor === PASSKEY_FACTOR;
}

/**
 * Whether this served session may act as an administrator — its address holding a grant it was made
 * since, inside both of the administrator's figures, and made by the passkey rather than by a mailed code alone.
 */
export function isAdminSession(served: ServedSession, { verwaltung, granted_since: berechtigt_seit }: Verwaltung): boolean {
  // A passkey enrolled before the grant still admits, on a sign-in after it: the grant is the privilege,
  // and a passkey the factor it asks, enrolled on the mailbox's own authority (`docs/ops/runbooks.md` §3).
  return verwaltung !== null && madeSince(served.session.createdAt, berechtigt_seit) && passesButForItsGrant(served);
}

/**
 * Why the administrator's guard turned a request away, by what repairs it: a sign-in for `signIn`; no
 * caller for `noGrant`, nor for `grantGone`, a session passing but for its grant; the backend for `unread`.
 */
export type AdminRefusal = "signIn" | "noGrant" | "grantGone" | "unread";

/**
 * The actor a guard records for this request, as the backend reads it beside the admin key. `null`
 * where the session cannot be stated truthfully: no address to fold, an unreadable creation stamp, or
 * a factor this league does not mint; the guard then answers no session.
 */
export function requestActorOf(
  served: { readonly user: { readonly email: string }; readonly session: { readonly createdAt: Date | string; readonly authFactor?: unknown } },
  lane: ActorLane,
): RequestActor | null {
  const email = asSignInIdentifier(served.user.email);
  const authTime = Math.floor(new Date(served.session.createdAt).getTime() / 1000);
  const factor = served.session.authFactor;

  if (email === "" || !Number.isFinite(authTime)) return null;
  if (factor !== PASSKEY_FACTOR && factor !== CODE_FACTOR) return null;

  return { email: email, lane: lane, authTime: authTime, factor: factor };
}

// React's `cache` within a render and `oncePerRequest` within an action, never `"use cache"`, which
// would hand one request's session to another: the backend still judges every call's actor.
const readAdminRequest = cache(
  oncePerRequest(async (): Promise<{ readonly session: JudgedSession; readonly actor: RequestActor } | { readonly refused: AdminRefusal }> => {
    const served = await readRequestSession();
    if (!served) return { refused: "signIn" };

    // An unread grant admits nobody, so the administration is shut while the backend is.
    const verwaltung = await verwaltungOrNull(served.user.email);
    if (verwaltung === null) return { refused: "unread" };
    if (verwaltung.verwaltung === null) return { refused: passesButForItsGrant(served) ? "grantGone" : "noGrant" };
    // A session made before its grant among them, which a sign-in after the grant repairs.
    if (!isAdminSession(served, verwaltung)) return { refused: "signIn" };

    // A session no actor can state truthfully is repaired by signing in afresh.
    const actor = requestActorOf(served, "admin");
    if (actor === null) return { refused: "signIn" };

    return { session: { ...served, verwaltung: true }, actor: actor };
  }),
);

/**
 * The administrator's guard with its reason, for a caller whose answer depends on why it refused; every
 * other caller takes `getAdminSession`, over this same read.
 */
export async function judgeAdminRequest(): Promise<{ readonly session: JudgedSession } | { readonly refused: AdminRefusal }> {
  const judged = await readAdminRequest();
  if ("refused" in judged) return judged;

  // On every call, outside the memo: a render's first read may precede every scope, and a later
  // scope answered from the memo would name nobody. The ordering is load-bearing.
  setRequestActor(judged.actor);

  return { session: judged.session };
}

/**
 * Neither throws nor redirects — hence `get`, not `require` — so it guards nothing on its own line.
 * **Check the return value**.
 */
export async function getAdminSession(): Promise<JudgedSession | null> {
  const judged = await judgeAdminRequest();
  return "session" in judged ? judged.session : null;
}
