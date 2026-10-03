"use server";

import { afterTheResponse } from "@/core/afterResponse";
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

/**
 * Behind the response, so an in-app change is announced at once rather than at the next tick, under a
 * deadline of its own: the action's remainder would cut a claim's sends and hold its rows for the lease.
 */
function ankuendigenNachDerAntwort(): void {
  afterTheResponse(runBerechtigungenAbgleich);
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

    // Ends no session: one made before the grant administers nothing, every guard holding it against the
    // grant's own time on every request (`docs/frontend/spec.md :: I470`).
    ankuendigenNachDerAntwort();

    return { success: true, created_id: postOperation.created_id, message: ZUGANG_ERTEILT };
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
