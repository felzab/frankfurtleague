import "server-only";

import { cache } from "react";
import { headers } from "next/headers";

import { apiClient } from "./api";
import { auth, isAdminSession, isWithinPersonLifetime } from "./auth";
import { asSignInIdentifier } from "./emailAddress";
import { setRequestActor } from "./requestScope";
import { FLSubjektResponseSchema } from "./schemas";

import type { FLSubjektPayload, FLSubjektSchiedsrichter, FLSubjektSitz, FLSubjektSpieler } from "./schemas";

/** Read-only to the depth a panel reaches: what the league holds is the endpoint's to change. */
type SubjectRecords = {
  readonly sitze: readonly Readonly<FLSubjektSitz>[];
  readonly spieler: readonly Readonly<FLSubjektSpieler>[];
  readonly schiedsrichter: readonly Readonly<FLSubjektSchiedsrichter>[];
  // Beside the lists rather than read off them: the lookup drops every unconfirmed record, so empty
  // lists alone cannot tell a person awaiting confirmation from one the league holds nothing for.
  readonly unbestaetigt: boolean;
};

/**
 * `admin` is the administrator's whole verdict (`fl_frontend/src/core/auth.ts :: isAdminSession`),
 * so a control gated on it admits exactly the sessions the administrator's own lane admits.
 */
export type SubjectSession = { readonly email: string; readonly admin: boolean; readonly subjekt: SubjectRecords };

// Both guards on one request is a programming error rather than a shape to support, and
// `fl_frontend/src/core/requestScope.ts :: setRequestActor` refuses the second actor
// (`docs/frontend/spec.md :: I272`).

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
  // person's write carrying no actor.
  setRequestActor(email);

  const payload: FLSubjektPayload = { email: email };
  // In the body and on no query parameter: a URL carrying an address reaches the edge's access
  // line, which nothing downstream un-logs (`docs/logging/spec.md :: L11`).
  const subjekt = await apiClient("/identitaet/subjekt", FLSubjektResponseSchema, {
    method: "POST",
    readOnly: true,
    authType: "system",
    body: JSON.stringify(payload),
  });

  // The records and the pending flag, never the parsed body: `acknowledged` is the transport saying
  // a write landed, which a panel reading records has nothing to do with.
  return {
    email: email,
    admin: isAdminSession(served),
    subjekt: {
      sitze: subjekt.sitze,
      spieler: subjekt.spieler,
      schiedsrichter: subjekt.schiedsrichter,
      unbestaetigt: subjekt.unbestaetigt,
    },
  };
});
