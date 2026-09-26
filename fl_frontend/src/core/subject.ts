import "server-only";

import { cache } from "react";
import { headers } from "next/headers";

import { auth, isAdminSession, isWithinPersonLifetime } from "./auth";
import { asSignInIdentifier } from "./emailAddress";
import { setRequestActor } from "./requestScope";
import { lookUpSubjekt } from "./signInGate";

import type { FLSubjektSchiedsrichter, FLSubjektSitz, FLSubjektSpieler } from "./schemas";

/** Read-only to the depth a panel reaches: what the league holds is the endpoint's to change. */
type SubjectRecords = {
  readonly sitze: readonly Readonly<FLSubjektSitz>[];
  readonly spieler: readonly Readonly<FLSubjektSpieler>[];
  readonly schiedsrichter: readonly Readonly<FLSubjektSchiedsrichter>[];
  // Beside the lists rather than read off them: the lookup drops every unconfirmed record, so empty
  // lists alone cannot tell a person awaiting confirmation from one the league holds nothing for.
  readonly unbestaetigt: boolean;
  // Passed through as answered: whether a barred address may still reach a panel is the sign-in
  // gate's to decide, and a second test of it here would be a second definition of "barred".
  readonly gesperrt: boolean;
};

/**
 * `admin` is the administrator's whole verdict (`fl_frontend/src/core/auth.ts :: isAdminSession`),
 * so a control gated on it admits exactly the sessions the administrator's own lane admits.
 */
export type SubjectSession = { readonly email: string; readonly admin: boolean; readonly subjekt: SubjectRecords };

// React's `cache`, never `"use cache"`, which would hand one request's session to another: a layout,
// a guard and a page of one render pass share one session read and one lookup.
/**
 * `null` where no readable session stands; every backend failure throws, so the panel takes an
 * error boundary rather than a sign-in nobody needs. A server action calling this wraps that throw
 * (`docs/logging/spec.md :: L6`).
 */
export const getSubjectSession = cache(async (): Promise<SubjectSession | null> => {
  const served = await auth.api.getSession({ headers: await headers() });
  // Both figures here as well as at `getAdminSession`: a lane that skips them is a lane in which
  // the cap does not exist.
  if (!served || !isWithinPersonLifetime(served.session)) return null;

  // One spelling per person, and none to fold is no session: the address as the session holds it
  // names a second mailbox to the join, the actor and the log alike.
  const email = served.user.email ? asSignInIdentifier(served.user.email) : "";

  // The library types this address as a string and the adapter answers whatever the row held, so an
  // empty one is refused here rather than at the endpoint, which answers 422.
  if (email === "") return null;

  // Set here rather than at the write: `fl_backend/app/core/security.py :: bind_actor` refuses a
  // person's write carrying no actor. Both guards on one request is a programming error, so the
  // second actor throws (`docs/frontend/spec.md :: I272`).
  setRequestActor(email);

  // The records and the two flags, never the parsed body (`fl_frontend/src/core/signInGate.ts :: lookUpSubjekt`).
  return { email: email, admin: isAdminSession(served), subjekt: await lookUpSubjekt(email) };
});
