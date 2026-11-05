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

import type { SubjectSession } from "../subject";
import type { Grant } from "../verwaltung";
import type { ServedSession } from "./session";

/** Where `/signin/continue` sends the session it was handed, before `/area` is resolved to the page it leads to. */
export type SignInDestination = "/signin/passkey" | "/area" | "/signin";

/**
 * Where `/signin/continue` sends the session, and, where that is `/area` and the backend answered, the person as the
 * landing read them, so the person area's own landing rule is asked of the reads already made.
 */
export async function getSignInLanding(): Promise<{ readonly destination: SignInDestination; readonly subject: SubjectSession | null }> {
  const { destination, subject } = await landingOf(await headers());
  return { destination, subject };
}

/**
 * The address `/signin` greets rather than offering a sign-in: one the landing would send on
 * anywhere but back to `/signin`, so a spent or unreadable session is offered a fresh sign-in.
 */
export async function getSignedInAddress(): Promise<string | null> {
  const { destination, served } = await landingOf(await headers());
  return destination === "/signin" || served === null ? null : asSignInIdentifier(served.user.email);
}

/** The landing's verdict, the session it judged where one stands, and the person it read where the backend answered. */
type Landing = { readonly destination: SignInDestination; readonly served: ServedSession | null; readonly subject: SubjectSession | null };

/**
 * Every guard that refuses a session sends it to `/signin`, so this is where one no lane will serve
 * again is ended, whatever missed ending it before.
 */
async function landingOf(requestHeaders: Headers): Promise<Landing> {
  // `readRequestSession`'s wait, for the sign-in pages' read past it.
  await connection();
  const read = await readLibrarySession(requestHeaders, false);
  if (read === null) return { destination: "/signin", served: null, subject: null };

  // Past a person's figures no lane serves it, so one past an administrator's alone stands, the person
  // lane still serving it; its passkey gone, none ever will.
  const served = await servedSessionOf(read);
  if (served === null || !isWithinPersonLifetime(read.session)) return ended(read);

  // An unread lookup is the backend down: `/area` answers it with the person area's outage panel, its
  // own lookup failing, where `/signin` would mail no code and say nothing.
  const subjectRecord = await subjectOrNull(served.user.email);
  if (subjectRecord === null) return { destination: "/area", served: served, subject: null };

  // The ban itself, never read through the grant: every guard behind `/area` refuses a barred session,
  // and one left standing serves again on the ban's lift with no sign-in.
  if (subjectRecord.barred) return ended(read);

  // As the person guard builds it (`fl_frontend/src/core/subject.ts`), off this one lookup.
  const subject = { email: asSignInIdentifier(served.user.email), admin: isAdminSession(served, subjectRecord), subject: subjectRecord };
  return { destination: await destinationOf(served, subjectRecord), served: served, subject: subject };
}

/**
 * Deleted by the row's id, never its token, which leaves the store for nothing. The browser keeps a
 * cookie naming no row, which every read answers as no session.
 */
async function ended(read: ServedSession): Promise<Landing> {
  const { adapter } = await auth.$context;
  await adapter.delete({ model: "session", where: [{ field: "id", value: read.session.id }] });
  return { destination: "/signin", served: null, subject: null };
}

async function destinationOf(served: ServedSession, grant: Grant): Promise<SignInDestination> {
  if (grant.verwaltung !== null) {
    // The guard's own verdict rather than a second spelling of it: `/area` sends a granted session
    // the guard refuses on to `/area/admin`, whose guards send it back here.
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
async function passkeyStepOf(served: ServedSession, admin: boolean): Promise<PasskeyStep["step"] | null> {
  if (admin ? !isAdminWithinWindow(served) : !isWithinPersonLifetime(served.session)) return null;
  // A session the passkey already made needs no card, whatever it holds.
  if (served.session.authFactor === PASSKEY_FACTOR) return null;

  // Past the library's `freshAge` the enrolment is refused, so no card offers one.
  const mayEnrol = isFreshForEnrolment(served.session);
  if (!admin && !mayEnrol) return null;

  // The question `refuseEnrolment` puts to the adapter, by the same user id: they agree or the page
  // offers a control the server refuses.
  const held = await passkeysOf(served.user.id);

  if (held.length > 0) return admin ? "assert" : null;
  if (!mayEnrol) return null;

  return admin ? "enrol" : "offer";
}

/** `null` where that page is not the caller's to see. */
export async function getPasskeyStep(): Promise<PasskeyStep | null> {
  const served = await readRequestSession();
  if (!served) return null;

  // An unread read offers no card, for the landing's reason; a barred subject none either, its
  // enrolment being refused.
  const subject = await subjectOrNull(served.user.email);
  if (subject === null || subject.barred) return null;

  const step = await passkeyStepOf(served, subject.verwaltung !== null);
  if (step === null) return null;

  // Folded as `getAdminSession` folds the actor it records: the stored row is the library's own
  // spelling, and this is the one address of this slice a person reads.
  return { step: step, email: asSignInIdentifier(served.user.email) };
}
