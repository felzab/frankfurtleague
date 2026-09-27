"use server";

import { after } from "next/server";

import { runOutsideRequestScope } from "@/core/requestScope";
import { refusalResult, runAdminMutation } from "@/shared/utils/adminMutation";
import { buildRefusal } from "@/shared/utils/refusal";
import { toFieldErrors, VALIDATION_FAILED } from "@/shared/utils/validation";

import { runBerechtigungenAbgleich } from "./abgleich";
import { ZUGANG_ENTZOGEN_MESSAGE, ZUGANG_ERTEILT } from "./constants";
import { deleteBerechtigung, postBerechtigung } from "./mutations";
import { mapEntziehenRefusal, mapErteilenRefusal } from "./refusals";
import { FLBerechtigungKeyPayloadSchema, FLPostBerechtigungPayloadSchema } from "./schemas";

import type { ActionResult } from "@/shared/types/types";
import type { FLBerechtigungKeyPayload, FLPostBerechtigungPayload } from "./schemas";

/**
 * The enrolment's five-minute window rather than the step-up's (`docs/frontend/spec.md :: I458`): a
 * grant outlives the session making it, and a revoke is the lockout lever.
 */
const ZUGANG_STEP_UP = { stepUp: "enrolment" } as const;

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
      return { success: false, error: buildRefusal({ reason: "Der Zugang wurde nicht erteilt", repair: "Versuche es erneut" }) };
    }

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
      return { success: false, error: buildRefusal({ reason: "Der Zugang wurde nicht entzogen", repair: "Versuche es erneut" }) };
    }

    ankuendigenNachDerAntwort();

    return { success: true, message: ZUGANG_ENTZOGEN_MESSAGE };
  });
}
