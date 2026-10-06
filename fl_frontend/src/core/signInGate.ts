import "server-only";

import { cache } from "react";

import { apiClient } from "./api";
import { asSignInIdentifier } from "./emailAddress";
import { APIBadStatusError } from "./errors";
import { logger } from "./logging";
import { FLAnmeldungResponseSchema, FLSubjektResponseSchema } from "./schemas";

import type { FLAnmeldungResponse, FLSubjektPayload } from "./schemas";
import type { SubjectSession } from "./subject";

/** The code the backend answers a payload it refuses with: here, an address no rule of its own accepts. */
const PAYLOAD_REFUSED = "REQ-VAL-001";

// React's `cache`, never `"use cache"`, which would hand one request's grant to another: the guards
// and the switcher of one render share one read, and outside a render nothing is kept.
/**
 * One folded mailbox's records, ban and grant, every reader but the sign-in gate taking them through this
 * one call: the gate, a passkey enrolment's included, reads `lookUpAnmeldung`. Throws on every backend
 * failure; `fl_frontend/src/core/subject.ts :: getSubjectSession` lets it.
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
    berechtigt_seit: answer.berechtigt_seit,
    inhaber_seit: answer.inhaber_seit,
  };
});

/** What the sign-in gate decides on for one mailbox: its two record flags, its ban and its grant. */
export type AnmeldungRecords = Omit<FLAnmeldungResponse, "acknowledged">;

// React's `cache` for `lookUpSubjekt`'s reason. Its own read rather than the subject's: only a sign-in
// pays for the two collections `konto` reads beyond the subject's three (`docs/backend/spec.md :: I_NEW_KONTO-BE_2`).
/** The gate's answer for one folded mailbox. Throws on every backend failure, which `mayReceiveSignIn` closes on. */
export const lookUpAnmeldung = cache(async (email: string): Promise<AnmeldungRecords> => {
  const payload: FLSubjektPayload = { email: email };
  // In the body, for `lookUpSubjekt`'s reason.
  const answer = await apiClient("/identitaet/anmeldung", FLAnmeldungResponseSchema, {
    method: "POST",
    readOnly: true,
    authType: "system",
    body: JSON.stringify(payload),
  });

  // Never the parsed body, for `lookUpSubjekt`'s reason.
  return { unbestaetigt: answer.unbestaetigt, konto: answer.konto, gesperrt: answer.gesperrt, verwaltung: answer.verwaltung };
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
  let anmeldung: AnmeldungRecords;

  // Behind the sign-in action's response the request scope still bounds the read, so a spent
  // deadline refuses it unsent and lands below (`docs/frontend/spec.md :: I366`).
  try {
    anmeldung = await lookUpAnmeldung(email);
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

  return signInVerdictOf(anmeldung);
}

/**
 * The gate over an answer already read, for a caller that read it where no round trip may run: the
 * registration's transaction (`fl_frontend/src/core/auth.ts :: refuseUnadmitted`).
 */
export function signInVerdictOf(anmeldung: AnmeldungRecords): Exclude<SignInVerdict, "failed"> {
  // Ahead of every record and the grant: a barred address still holding a seat, awaiting a
  // confirmation or holding a grant written in the database directly is offered nothing.
  if (anmeldung.gesperrt) return "barred";

  if (anmeldung.verwaltung !== null) return "admitted";

  // `konto` and never a Funktion: a person whose only record grants no panel still has a consent to
  // take back on the account page. A pending mailbox signs in too, to be told its confirmation is
  // outstanding.
  return anmeldung.konto || anmeldung.unbestaetigt ? "admitted" : "holds-nothing";
}
