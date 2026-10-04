import "server-only";

import { cache } from "react";

import { mintRequestActor } from "./actorToken";
import { isAdminSession, isWithinPersonLifetime, readRequestSession } from "./auth";
import { asSignInIdentifier } from "./emailAddress";
import { setRequestActor } from "./requestScope";
import { lookUpSubjekt } from "./signInGate";

import type { RequestActor } from "./requestScope";
import type { FLSubjektResponse, FLSubjektSchiedsrichter, FLSubjektSitz, FLSubjektSpieler } from "./schemas";

/** Read-only to the depth a panel reaches: what the league holds is the endpoint's to change. */
type SubjectRecords = {
  readonly sitze: readonly Readonly<FLSubjektSitz>[];
  readonly spieler: readonly Readonly<FLSubjektSpieler>[];
  readonly schiedsrichter: readonly Readonly<FLSubjektSchiedsrichter>[];
  // Beside the lists rather than read off them: the lookup drops every unconfirmed record, so empty
  // lists alone cannot tell a person awaiting confirmation from one the league holds nothing for.
  readonly unbestaetigt: boolean;
  // The backend's own verdict, never recomputed here; `getSubjectSession` serves no subject that
  // carries it set, so only a caller of the lookup itself ever reads it `true`.
  readonly gesperrt: boolean;
  // The grant the address holds, stored and never derived: whether it may act as an administrator is
  // `SubjectSession["admin"]`, which the session's factor and window narrow further.
  readonly verwaltung: FLSubjektResponse["verwaltung"];
  // When that grant took effect, which the same verdict holds the session's own making against.
  readonly berechtigt_seit: FLSubjektResponse["berechtigt_seit"];
  // When its `owner` tier took effect, which no panel reads: an owner's controls ask it of the session.
  readonly inhaber_seit: FLSubjektResponse["inhaber_seit"];
};

/**
 * `admin` is the administrator's whole verdict (`fl_frontend/src/core/auth.ts :: isAdminSession`),
 * so a control gated on it admits exactly the sessions the administrator's own lane admits.
 */
export type SubjectSession = { readonly email: string; readonly admin: boolean; readonly subjekt: SubjectRecords };

// React's `cache`, never `"use cache"`, which would hand one request's session to another: a layout,
// a guard and a page of one render pass share one session read, one lookup and one signed actor.
const judgeSubjectSession = cache(async (): Promise<{ subject: SubjectSession; actor: RequestActor } | null> => {
  const served = await readRequestSession();
  // Both figures here as well as at `getAdminSession`: a lane that skips them is a lane in which
  // the cap does not exist.
  if (!served || !isWithinPersonLifetime(served.session)) return null;

  // One spelling per person, and none to fold is no session: the address as the session holds it
  // names a second mailbox to the join, the actor and the log alike.
  const email = served.user.email ? asSignInIdentifier(served.user.email) : "";

  // The library types this address as a string and the adapter answers whatever the row held, so an
  // empty one is refused here rather than at the endpoint, which answers 422.
  if (email === "") return null;

  // The records and the two flags, never the parsed body (`fl_frontend/src/core/signInGate.ts :: lookUpSubjekt`).
  const subjekt = await lookUpSubjekt(email);

  // On every request rather than only at the ban: a session minted racing the ban, or one its ending
  // missed, is no session here (`docs/frontend/spec.md :: I406`).
  if (subjekt.gesperrt) return null;

  // Minted here rather than at the write: a person's route refuses a request carrying no signed
  // actor of this lane (`fl_backend/app/core/security.py :: person_actor_binder`).
  const actor = await mintRequestActor(served, "person");
  if (actor === null) return null;

  // Off the lookup this guard already made, so the verdict costs no second read.
  return { subject: { email: email, admin: isAdminSession(served, subjekt), subjekt: subjekt }, actor: actor };
});

/**
 * `null` where no readable session stands, or its subject is barred; every backend failure throws,
 * so the panel takes an error boundary rather than a sign-in nobody needs. A server action calling
 * this wraps that throw (`docs/logging/spec.md :: L6`).
 */
export async function getSubjectSession(): Promise<SubjectSession | null> {
  const judged = await judgeSubjectSession();
  if (judged === null) return null;

  // On every call, outside the memo, for `getAdminSession`'s reason. Both guards on one request is a
  // programming error, so the second actor throws (`docs/frontend/spec.md :: I272`).
  setRequestActor(judged.actor);

  return judged.subject;
}
