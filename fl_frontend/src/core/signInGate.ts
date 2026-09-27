import "server-only";

import { cache } from "react";

import { apiClient } from "./api";
import { asSignInIdentifier } from "./emailAddress";
import { APIBadStatusError } from "./errors";
import { funktionenOf } from "./funktionen";
import { logger } from "./logging";
import { FLSubjektResponseSchema } from "./schemas";

import type { FLSubjektPayload } from "./schemas";
import type { SubjectSession } from "./subject";

/** The code the backend answers a payload it refuses with: here, an address no rule of its own accepts. */
const PAYLOAD_REFUSED = "REQ-VAL-001";

// React's `cache`, never `"use cache"`, which would hand one request's grant to another: the guards
// and the switcher of one render share one read, and outside a render nothing is kept.
/**
 * One folded mailbox's records, ban and grant, every caller reading them through this one call. Throws
 * on every backend failure; `fl_frontend/src/core/subject.ts :: getSubjectSession` lets it.
 */
export const lookUpSubjekt = cache(async (email: string): Promise<SubjectSession["subjekt"]> => {
  const payload: FLSubjektPayload = { email: email };
  // In the body and on no query parameter: a URL carrying an address reaches the edge's access
  // line, which nothing downstream un-logs (`docs/logging/spec.md :: L11`).
  const answer = await apiClient("/identitaet/subjekt", FLSubjektResponseSchema, {
    method: "POST",
    readOnly: true,
    authType: "system",
    body: JSON.stringify(payload),
  });

  // Never the parsed body: `acknowledged` is the transport saying a write landed, which a caller
  // reading records has nothing to do with.
  return {
    sitze: answer.sitze,
    spieler: answer.spieler,
    schiedsrichter: answer.schiedsrichter,
    unbestaetigt: answer.unbestaetigt,
    gesperrt: answer.gesperrt,
    verwaltung: answer.verwaltung,
  };
});

/**
 * Why a sign-in is or is not offered; `admitted` alone is offered one. A sender that answers the
 * person before it knows the outcome answers every other reason exactly as `admitted`.
 */
export type SignInVerdict = "admitted" | "barred" | "holds-nothing" | "failed";

/**
 * Whether a sign-in may be offered to this address, and why not, whichever sender asks: the whole
 * gate, never spelled a second time. It never throws.
 */
export async function mayReceiveSignIn(identifier: string): Promise<SignInVerdict> {
  const email = asSignInIdentifier(identifier);
  let subjekt: SubjectSession["subjekt"];

  // Behind the sign-in action's response the request scope still bounds the read, so a spent
  // deadline refuses it unsent and lands below (`docs/frontend/spec.md :: I366`).
  try {
    subjekt = await lookUpSubjekt(email);
  } catch (failed) {
    // Closed, for an administrator too: a sign-in past a failed read would defeat the ban. The person
    // cannot tell this from an unknown address, so the line is the only signal, carrying the name alone.
    const refused = failed instanceof APIBadStatusError && failed.serverErrorCode === PAYLOAD_REFUSED;
    logger.error(refused ? "auth.sign_in_gate_address_refused" : "auth.sign_in_gate_failed", undefined, {
      error_code: "FE-AUTH-002",
      name: failed instanceof Error ? failed.name : "unknown",
    });
    return "failed";
  }

  return signInVerdictOf(email, subjekt);
}

/**
 * The gate over records already read, for a caller that read them where no round trip may run: the
 * registration's transaction (`fl_frontend/src/core/auth.ts :: refuseUnadmitted`). `email` is folded.
 */
export function signInVerdictOf(email: string, subjekt: SubjectSession["subjekt"]): Exclude<SignInVerdict, "failed"> {
  // Ahead of every record and the grant: a barred address still holding a seat, awaiting a
  // confirmation or holding a grant written in the database directly is offered nothing.
  if (subjekt.gesperrt) return "barred";

  if (subjekt.verwaltung !== null) return "admitted";

  const { funktionen, unbestaetigt } = funktionenOf({ email: email, admin: false, subjekt: subjekt });

  // A pending mailbox signs in too, to be told its confirmation is outstanding: the flag and never
  // the lists, which drop every unconfirmed record. A `past` season's seat alone admits nothing.
  return funktionen.length > 0 || unbestaetigt ? "admitted" : "holds-nothing";
}
