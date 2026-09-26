import "server-only";

import { isUserAdmin } from "./allowlist";
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

/**
 * One folded mailbox's records and ban, every caller reading them through this one call. Throws on
 * every backend failure; `fl_frontend/src/core/subject.ts :: getSubjectSession` lets it.
 */
export async function lookUpSubjekt(email: string): Promise<SubjectSession["subjekt"]> {
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
  };
}

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
  // First and in process, so an administrator's sign-in is never hostage to a backend call; moved
  // behind the read, an unreachable backend locks every administrator out.
  if (isUserAdmin(identifier)) return "admitted";

  const email = asSignInIdentifier(identifier);
  let subjekt: SubjectSession["subjekt"];

  // Behind the sign-in action's response the request scope still bounds the read, so a spent
  // deadline refuses it unsent and lands below (`docs/frontend/spec.md :: I366`).
  try {
    subjekt = await lookUpSubjekt(email);
  } catch (failed) {
    // Closed: a sign-in past a failed read would defeat the ban. The person cannot tell this from an
    // unknown address, so the line is the only signal, carrying the name alone as the send's does.
    const refused = failed instanceof APIBadStatusError && failed.serverErrorCode === PAYLOAD_REFUSED;
    logger.error(refused ? "auth.link_gate_address_refused" : "auth.link_gate_failed", undefined, {
      error_code: "FE-AUTH-002",
      name: failed instanceof Error ? failed.name : "unknown",
    });
    return "failed";
  }

  // Ahead of every record: a barred address still holding a seat, or awaiting a confirmation, is
  // offered nothing.
  if (subjekt.gesperrt) return "barred";

  const { funktionen, unbestaetigt } = funktionenOf({ email: email, admin: false, subjekt: subjekt });

  // A pending mailbox signs in too, to be told its confirmation is outstanding: the flag and never
  // the lists, which drop every unconfirmed record. A `past` season's seat alone admits nothing.
  return funktionen.length > 0 || unbestaetigt ? "admitted" : "holds-nothing";
}
