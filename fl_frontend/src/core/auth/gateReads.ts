import "server-only";

import { APIError } from "better-auth/api";

import { asSignInIdentifier } from "../emailAddress";
import { grantOf } from "../grant";
import { logger } from "../logging";
import { lookUpSignIn, lookUpSubject } from "../signInGate";

import type { Grant } from "../grant";
import type { SignInRecords } from "../signInGate";
import type { SubjectSession } from "../subject";

/** Logged where the grant was asked for, as the send gate's own failure is: the error's name alone. */
function logUnreadGrant(failed: unknown): void {
  logger.error("auth.grant_unread", undefined, {
    name: failed instanceof Error ? failed.name : "unknown",
  });
}

/**
 * The gate's answer an enrolment is judged by, where an unread read must refuse rather than admit: a
 * barred address would otherwise enrol while the backend is down.
 */
export async function enrolmentSignIn(email: string): Promise<SignInRecords> {
  try {
    return await lookUpSignIn(asSignInIdentifier(email));
  } catch (failed) {
    logUnreadGrant(failed);
    throw APIError.fromStatus("SERVICE_UNAVAILABLE");
  }
}

/** The records where an unread read offers nothing: `null` where the backend could not say. */
export async function subjectOrNull(email: string): Promise<SubjectSession["subject"] | null> {
  try {
    return await lookUpSubject(asSignInIdentifier(email));
  } catch (failed) {
    logUnreadGrant(failed);
    return null;
  }
}

/** The grant and when it took effect, where an unread one admits nobody: `null` where the backend could not say. */
export async function grantOrNull(email: string): Promise<Grant | null> {
  try {
    return await grantOf(email);
  } catch (failed) {
    logUnreadGrant(failed);
    return null;
  }
}
