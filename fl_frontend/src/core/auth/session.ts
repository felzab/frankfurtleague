import "server-only";

import { cache } from "react";
import { headers } from "next/headers";
import { connection } from "next/server";

import { isAPIError } from "better-auth/api";

import { auth } from "./library";
import { endedByItsAccount, PASSKEY_FACTOR } from "./sessionStamps";

/** The library's own read of the session a request's cookie names, the row's `token` among its fields. */
type LibraryRead = NonNullable<Awaited<ReturnType<typeof auth.api.getSession>>>;

/**
 * What every guard is handed, built fresh off the library's read and never that read whole: the row
 * carries its own `token`, which is the value of the `httpOnly` cookie.
 */
export type ServedSession = {
  user: { id: string; email: string; sessionsEndedAt?: Date | null };
  session: Pick<LibraryRead["session"], "id" | "createdAt" | "updatedAt" | "authFactor" | "passkeyCredentialId" | "adminLapsed">;
};

function projected({ user, session }: LibraryRead): ServedSession {
  return {
    user: { id: user.id, email: user.email, sessionsEndedAt: user.sessionsEndedAt ?? null },
    session: {
      // The row's id and never its token: „Alle anderen abmelden“ keeps the session it ran in by it, and the landing
      // ends a session no lane serves by it.
      id: session.id,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      authFactor: session.authFactor,
      passkeyCredentialId: session.passkeyCredentialId,
      adminLapsed: session.adminLapsed,
    },
  };
}

/**
 * The session the request's cookie names, or `null` where it names none. A store that does not answer
 * throws rather than reading as signed out.
 */
export async function readLibrarySession(requestHeaders: Headers, slide: boolean): Promise<ServedSession | null> {
  try {
    const read = await auth.api.getSession({ headers: requestHeaders, query: slide ? {} : { disableRefresh: true } });
    return read === null ? null : projected(read);
  } catch (failed) {
    // The library's word for a row ended between its read and its refresh, which is no session at all;
    // every other throw is the store's, worded `INTERNAL_SERVER_ERROR` and logged through the library's `logger`
    // (`fl_frontend/src/core/auth/library.ts`).
    if (isAPIError(failed) && failed.status === "UNAUTHORIZED") return null;
    throw failed;
  }
}

/**
 * The session every guard serves. It never slides the session: a page render cannot write the
 * cookie, so a refresh here would carry the row past the cookie the browser holds.
 */
export async function readServedSession(requestHeaders: Headers): Promise<ServedSession | null> {
  return servedSessionOf(await readLibrarySession(requestHeaders, false));
}

// React's `cache`, never `"use cache"`, which would hand one request's session to another: the
// account page's guard, the person guard and the administrator's guard of one render share one read.
/** The session this request's cookie names, as every guard serves it. */
export const readRequestSession = cache(async (): Promise<ServedSession | null> => {
  // A render's one wait for a real request, before the sign-in store: the image's build reaches no store, and a
  // prefetched shell must carry nothing a session decides.
  await connection();
  return readServedSession(await headers());
});

/**
 * The proxy's read: the proxy runs ahead of the render and can still write a cookie, so the library's
 * refresh past `updateAge` lands whole, `nextCookies()` carrying its cookie onto the proxy's answer.
 */
export async function slideSession(requestHeaders: Headers): Promise<void> {
  await readLibrarySession(requestHeaders, true);
}

/**
 * `null` where the account's sessions were ended after this one was made, or where a passkey no row
 * holds made it: a sign-in racing that passkey's removal inserts its session after the removal's
 * sign-out ran.
 */
export async function servedSessionOf(served: ServedSession | null): Promise<ServedSession | null> {
  if (served === null || endedByItsAccount(served)) return null;
  if (served.session.authFactor !== PASSKEY_FACTOR) return served;

  const credentialID: unknown = served.session.passkeyCredentialId;
  if (typeof credentialID !== "string" || credentialID === "") return null;

  const { adapter } = await auth.$context;
  const held = await adapter.findOne<{ id: string }>({
    model: "passkey",
    where: [
      { field: "credentialID", value: credentialID },
      { field: "userId", value: served.user.id },
    ],
  });

  return held === null ? null : served;
}
