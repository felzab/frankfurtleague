import "server-only";

import { headers } from "next/headers";
import { connection } from "next/server";

import { asSignInIdentifier } from "../emailAddress";
import { ROUTES } from "../routes";
import { subjectOrNull } from "./gateReads";
import { isAdminSession, isAdminWithinWindow } from "./guards";
import { auth } from "./library";
import { passkeysOf } from "./passkeys";
import { readLibrarySession, readRequestSession, readServedSession, servedSessionOf } from "./session";
import { isFreshForEnrolment, isWithinPersonLifetime, PASSKEY_FACTOR } from "./sessionStamps";

import type { Grant } from "../grant";
import type { SubjectSession } from "../subject";
import type { ServedSession } from "./session";

/** Where `/signin/continue` sends the session it was handed, before `/area` is resolved to the page it leads to. */
type SignInDestination = "/signin/passkey" | "/area" | "/signin";

/**
 * Where `/signin/continue` sends the session, and, where that is `/area` and the backend answered, the person as the
 * landing read them, so the person area's own landing rule is asked of the reads already made.
 */
export async function getSignInLanding(): Promise<Landing> {
  return landingOf(await headers());
}

/**
 * The landing's verdict, the person it read where the backend answered, and the page a sign-in it sends afresh returns
 * to where the request named none.
 */
type Landing = { readonly destination: SignInDestination; readonly subject: SubjectSession | null; readonly returnsTo?: string };

/**
 * Every guard that refuses a session sends it to the sign-in or here, and the proxy sends every session asking for
 * `/signin` here, so this is where each one the landing sends to sign in afresh is ended, whatever missed ending it
 * before: one left standing would be sent from the sign-in to the landing and back again.
 */
async function landingOf(requestHeaders: Headers): Promise<Landing> {
  // A wait for a real request before the sign-in store: the image's build reaches no store, and a prefetched
  // shell must carry nothing a session decides.
  await connection();
  const read = await readLibrarySession(requestHeaders, false);
  if (read === null) return { destination: "/signin", subject: null };

  // Past a person's figures no lane serves it; its passkey gone, none ever will. Ended before any grant is read, it
  // returns to no page, as a cookie naming no row does above: an administrator signs in by a mailed code, which leads
  // on to the passkey step all the same, rather than every such end costing a read of the backend.
  const served = await servedSessionOf(read);
  if (served === null || !isWithinPersonLifetime(read.session)) return ended(read);

  // An unread lookup is the backend down: `/area` answers it with the person area's outage panel, its
  // own lookup failing, where `/signin` would mail no code and say nothing.
  const records = await subjectOrNull(served.user.email);
  if (records === null) return { destination: "/area", subject: null };

  // A granted address's session past the administrator's figures, which the person lane alone would still serve,
  // ends here too, as the owner ruled: the administrator signs in afresh rather than holding a session that opens
  // neither the administration nor the landing. It returns to the administration, whichever guard sent it here naming
  // no page.
  const destination = await destinationOf(served, records);
  if (destination === "/signin") return { ...(await ended(served)), returnsTo: ROUTES.admin.path() };

  // As the person guard builds it, off this one lookup.
  return { destination, subject: { email: asSignInIdentifier(served.user.email), isAdmin: isAdminSession(served, records), records } };
}

/**
 * Deleted by the row's id, never its token, which leaves the store for nothing. The browser keeps a
 * cookie naming no row, which every read answers as no session, and the proxy's next slide expires.
 */
async function ended(read: ServedSession): Promise<Landing> {
  const { adapter } = await auth.$context;
  await adapter.delete({ model: "session", where: [{ field: "id", value: read.session.id }] });
  return { destination: "/signin", subject: null };
}

async function destinationOf(served: ServedSession, grant: Grant): Promise<SignInDestination> {
  // A person is offered no passkey, so their sign-in goes on: a first passkey would outrank their mailbox for good.
  if (grant.admin_tier === null) return "/area";

  // The guard's own verdict rather than a second spelling of it: `/area` sends a granted session
  // the guard refuses back here.
  if (isAdminSession(served, grant)) return "/area";

  // Where the passkey page has no step to offer, the session is spent, and an administrator signs in
  // afresh rather than being sent to a person's landing with no way to the step they owe.
  return (await passkeyStepOf(served)) === null ? "/signin" : "/signin/passkey";
}

/** Which card `/signin/passkey` shows: an administrator's required enrolment or assertion. */
export type PasskeyStep = { readonly step: "enrol" | "assert"; readonly email: string };

/**
 * The one answer both functions around it give for an administrator, so the landing never sends a session to a page
 * that then has nothing to show it and sends it back.
 */
async function passkeyStepOf(served: ServedSession): Promise<PasskeyStep["step"] | null> {
  if (!isAdminWithinWindow(served)) return null;
  // A session the passkey already made needs no card, whatever it holds.
  if (served.session.authFactor === PASSKEY_FACTOR) return null;

  // The question `refuseEnrolment` puts to the adapter, by the same user id: they agree or the page
  // offers a control the server refuses.
  if ((await passkeysOf(served.user.id)).length > 0) return "assert";

  // Past the library's `freshAge` the enrolment is refused, so no card offers one.
  return isFreshForEnrolment(served.session) ? "enrol" : null;
}

/** `null` where that page is not the caller's to see: the render's answer, off the session its guards share. */
export async function getPasskeyStep(): Promise<PasskeyStep | null> {
  return passkeyStepFor(await readRequestSession());
}

/** The same answer for the request the proxy is handed, before anything renders. */
export async function getRequestPasskeyStep(requestHeaders: Headers): Promise<PasskeyStep | null> {
  return passkeyStepFor(await readServedSession(requestHeaders));
}

async function passkeyStepFor(served: ServedSession | null): Promise<PasskeyStep | null> {
  if (!served) return null;

  // A person's session owes no step: the enrolment refuses an address holding no grant.
  const subject = await subjectOrNull(served.user.email);
  if (subject === null || subject.admin_tier === null) return null;

  const step = await passkeyStepOf(served);
  if (step === null) return null;

  // Folded: the stored row is the library's own spelling, and this is the one address of this slice a
  // person reads.
  return { step, email: asSignInIdentifier(served.user.email) };
}
