"use server";

import { after } from "next/server";

import { endSessionsOfAddress } from "@/core/auth";
import { logger } from "@/core/logging";
import { runOutsideRequestScope } from "@/core/requestScope";
import { refusalResult, runAdminMutation } from "@/shared/utils/adminMutation";
import { buildRefusal, VERSUCHE_ES_ERNEUT } from "@/shared/utils/refusal";
import { toFieldErrors, VALIDATION_FAILED } from "@/shared/utils/validation";

import { runBerechtigungenAbgleich } from "./abgleich";
import { STUFE_GEAENDERT_MESSAGE, ZUGANG_ENTZOGEN_MESSAGE, ZUGANG_ERTEILT } from "./constants";
import { deleteBerechtigung, patchBerechtigung, postBerechtigung } from "./mutations";
import { mapEntziehenRefusal, mapErteilenRefusal, mapStufeRefusal } from "./refusals";
import { FLBerechtigungKeyPayloadSchema, FLPatchBerechtigungPayloadSchema, FLPostBerechtigungPayloadSchema } from "./schemas";

import type { ActionResult } from "@/shared/types/types";
import type { FLBerechtigungKeyPayload, FLPatchBerechtigungPayload, FLPostBerechtigungPayload } from "./schemas";

/**
 * The enrolment's five-minute window rather than the step-up's (`docs/frontend/spec.md :: I458`): a
 * grant and a promotion outlive the session making them, and a revoke is the lockout lever.
 */
const ZUGANG_STEP_UP = { stepUp: "enrolment" } as const;

/** The ban's own sentence for the same failure: the address's sessions outlived the change. */
const ANMELDUNGEN_NICHT_BEENDET = "Laufende Anmeldungen der Adresse konnten nicht beendet werden.";

/**
 * Ends the grantee's sessions, as a change of privilege rotates the session: one made before the grant,
 * by a passkey enrolled while the address held none, would otherwise administer at once. A failure
 * leaves the grant standing and is told.
 */
async function abmelden(email: string): Promise<string | null> {
  try {
    await endSessionsOfAddress(email);
    return null;
  } catch (failed) {
    // The NAME alone: the address must reach no line.
    logger.error("berechtigung.sessions_not_ended", undefined, {
      error_code: "FE-AUTH-006",
      name: failed instanceof Error ? failed.name : "unknown",
    });
    return ANMELDUNGEN_NICHT_BEENDET;
  }
}

/**
 * Behind the response, so an in-app change is announced at once rather than at the next tick, and in no
 * request: the action's deadline would cut the sends of a claim that then holds its rows for the lease.
 */
function ankuendigenNachDerAntwort(): void {
  after(() => runOutsideRequestScope(runBerechtigungenAbgleich));
}

export async function postBerechtigungAction(rawPayload: FLPostBerechtigungPayload): Promise<ActionResult<{ created_id: string }>> {
  return runAdminMutation("postBerechtigungAction", ZUGANG_STEP_UP, async () => {
    const validated = FLPostBerechtigungPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return { success: false, error: VALIDATION_FAILED, fieldErrors: toFieldErrors(validated.error) };
    }

    let postOperation;
    try {
      postOperation = await postBerechtigung(validated.data);
    } catch (error) {
      const refusal = mapErteilenRefusal(error);
      if (refusal) return refusalResult(refusal);
      throw error;
    }

    if (!postOperation.acknowledged) {
      return { success: false, error: buildRefusal({ reason: "Der Zugang wurde nicht erteilt", repair: VERSUCHE_ES_ERNEUT }) };
    }

    // After the write is acknowledged, so nobody is signed out by a grant that then failed.
    const abgemeldet = await abmelden(validated.data.email);
    ankuendigenNachDerAntwort();

    return { success: true, created_id: postOperation.created_id, message: abgemeldet ?? ZUGANG_ERTEILT };
  });
}

/** A grant another administrator has already revoked answers 404, which the shared reader words as the reload it is. */
export async function deleteBerechtigungAction(rawPayload: FLBerechtigungKeyPayload): Promise<ActionResult> {
  return runAdminMutation("deleteBerechtigungAction", ZUGANG_STEP_UP, async () => {
    const validated = FLBerechtigungKeyPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return { success: false, error: VALIDATION_FAILED, fieldErrors: toFieldErrors(validated.error) };
    }

    let deleteOperation;
    try {
      deleteOperation = await deleteBerechtigung(validated.data);
    } catch (error) {
      const refusal = mapEntziehenRefusal(error);
      if (refusal) return refusalResult(refusal);
      throw error;
    }

    if (!deleteOperation.acknowledged) {
      return { success: false, error: buildRefusal({ reason: "Der Zugang wurde nicht entzogen", repair: VERSUCHE_ES_ERNEUT }) };
    }

    ankuendigenNachDerAntwort();

    return { success: true, message: ZUGANG_ENTZOGEN_MESSAGE };
  });
}

/**
 * An owner's promotion, demotion or step-down. Ends no session: the tier is read on every request
 * (`docs/frontend/spec.md :: I121`), so the next one already holds the new tier.
 */
export async function patchBerechtigungAction(rawPayload: FLPatchBerechtigungPayload): Promise<ActionResult> {
  return runAdminMutation("patchBerechtigungAction", ZUGANG_STEP_UP, async () => {
    const validated = FLPatchBerechtigungPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return { success: false, error: VALIDATION_FAILED, fieldErrors: toFieldErrors(validated.error) };
    }

    let patchOperation;
    try {
      patchOperation = await patchBerechtigung(validated.data);
    } catch (error) {
      const refusal = mapStufeRefusal(error);
      if (refusal) return refusalResult(refusal);
      throw error;
    }

    if (!patchOperation.acknowledged) {
      return { success: false, error: buildRefusal({ reason: "Die Stufe wurde nicht geändert", repair: VERSUCHE_ES_ERNEUT }) };
    }

    ankuendigenNachDerAntwort();

    // Done whether it moved the tier or found it there: a repeated press names the tier the grant holds.
    return { success: true, message: STUFE_GEAENDERT_MESSAGE[validated.data.verwaltung] };
  });
}
