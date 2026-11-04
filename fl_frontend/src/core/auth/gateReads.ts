import "server-only";

import { APIError } from "better-auth/api";

import { asSignInIdentifier } from "../emailAddress";
import { logger } from "../logging";
import { lookUpAnmeldung, lookUpSubjekt } from "../signInGate";
import { verwaltungOf } from "../verwaltung";

import type { AnmeldungRecords } from "../signInGate";
import type { SubjectSession } from "../subject";
import type { Verwaltung } from "../verwaltung";

/** Logged where the grant was asked for, as the send gate's own failure is: the error's name alone. */
function logUnreadVerwaltung(failed: unknown): void {
  logger.error("auth.verwaltung_unread", undefined, {
    name: failed instanceof Error ? failed.name : "unknown",
  });
}

/**
 * The gate's answer an enrolment is judged by, where an unread read must refuse rather than admit: a
 * barred address would otherwise enrol while the backend is down.
 */
export async function enrolmentAnmeldung(email: string): Promise<AnmeldungRecords> {
  try {
    return await lookUpAnmeldung(asSignInIdentifier(email));
  } catch (failed) {
    logUnreadVerwaltung(failed);
    throw APIError.fromStatus("SERVICE_UNAVAILABLE");
  }
}

/** The records where an unread read offers nothing: `null` where the backend could not say. */
export async function subjektOrNull(email: string): Promise<SubjectSession["subject"] | null> {
  try {
    return await lookUpSubjekt(asSignInIdentifier(email));
  } catch (failed) {
    logUnreadVerwaltung(failed);
    return null;
  }
}

/** The grant and when it took effect, where an unread one admits nobody: `null` where the backend could not say. */
export async function verwaltungOrNull(email: string): Promise<Verwaltung | null> {
  try {
    return await verwaltungOf(email);
  } catch (failed) {
    logUnreadVerwaltung(failed);
    return null;
  }
}
