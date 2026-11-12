import "server-only";

import { headers } from "next/headers";
import { connection } from "next/server";

import { asSignInIdentifier } from "../emailAddress";
import { subjectOrNull } from "./gateReads";
import { isAdminSession, isAdminWithinWindow } from "./guards";
import { auth } from "./library";
import { passkeysOf } from "./passkeys";
import { readLibrarySession, readRequestSession, servedSessionOf } from "./session";
import { isFreshForEnrolment, isWithinPersonLifetime, PASSKEY_FACTOR } from "./sessionStamps";

import type { Grant } from "../grant";
import type { SubjectSession } from "../subject";
import type { ServedSession } from "./session";

/** Where `/signin/continue` sends the session it was handed, before `/area` is resolved to the page it leads to. */
export type SignInDestination = "/signin/passkey" | "/area" | "/signin";

/**
 * Where `/signin/continue` sends the session, and, where that is `/area` and the backend answered, the person as the
 * landing read them, so the person area's own landing rule is asked of the reads already made.
 */
export async function getSignInLanding(): Promise<Landing> {
  return landingOf(await headers());
}

/** The landing's verdict, and the person it read where the backend answered. */
type Landing = { readonly destination: SignInDestination; readonly subject: SubjectSession | null };

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

  // Past a person's figures no lane serves it; its passkey gone, none ever will.
  const served = await servedSessionOf(read);
  if (served === null || !isWithinPersonLifetime(read.session)) return ended(read);

  // An unread lookup is the backend down: `/area` answers it with the person area's outage panel, its
  // own lookup failing, where `/signin` would mail no code and say nothing.
  const records = await subjectOrNull(served.user.email);
  if (records === null) return { destination: "/area", subject: null };

  // A granted address's session past the administrator's figures, which the person lane alone would still serve,
  // ends here too, as the owner ruled: the administrator signs in afresh rather than holding a session that opens
  // neither the administration nor the landing.
  const destination = await destinationOf(served, records);
  if (destination === "/signin") return ended(served);

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
  if (grant.admin_tier !== null) {
    // The guard's own verdict rather than a second spelling of it: `/area` sends a granted session
    // the guard refuses back here.
    if (isAdminSession(served, grant)) return "/area";

    // Where the passkey page has no step to offer, the session is spent, and an administrator signs in
    // afresh rather than being sent to a person's landing with no way to the step they owe.
    return (await passkeyStepOf(served, true)) === null ? "/signin" : "/signin/passkey";
  }

  return (await passkeyStepOf(served, false)) === "offer" ? "/signin/passkey" : "/area";
}

/**
 * Which card `/signin/passkey` shows: an administrator's required enrolment or assertion, or the
 * passkey offered to a person, whose „Später“ goes on to `/area`.
 */
export type PasskeyStep = { readonly step: "enrol" | "assert" | "offer"; readonly email: string };

/**
 * The one answer both functions around it give, so the landing never sends a session to a page that
 * then has nothing to show it and sends it back.
 */
async function passkeyStepOf(served: ServedSession, isAdmin: boolean): Promise<PasskeyStep["step"] | null> {
  if (isAdmin ? !isAdminWithinWindow(served) : !isWithinPersonLifetime(served.session)) return null;
  // A session the passkey already made needs no card, whatever it holds.
  if (served.session.authFactor === PASSKEY_FACTOR) return null;

  // Past the library's `freshAge` the enrolment is refused, so no card offers one.
  const mayEnrol = isFreshForEnrolment(served.session);
  if (!isAdmin && !mayEnrol) return null;

  // The question `refuseEnrolment` puts to the adapter, by the same user id: they agree or the page
  // offers a control the server refuses.
  const held = await passkeysOf(served.user.id);

  if (held.length > 0) return isAdmin ? "assert" : null;
  if (!mayEnrol) return null;

  return isAdmin ? "enrol" : "offer";
}

/** `null` where that page is not the caller's to see. */
export async function getPasskeyStep(): Promise<PasskeyStep | null> {
  const served = await readRequestSession();
  if (!served) return null;

  const subject = await subjectOrNull(served.user.email);
  if (subject === null) return null;

  const step = await passkeyStepOf(served, subject.admin_tier !== null);
  if (step === null) return null;

  // Folded: the stored row is the library's own spelling, and this is the one address of this slice a
  // person reads.
  return { step, email: asSignInIdentifier(served.user.email) };
}
