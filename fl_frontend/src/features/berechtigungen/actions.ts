"use server";

import { refusalResult, runAdminMutation } from "@/shared/utils/adminMutation";
import { toFieldErrors, VALIDATION_FAILED } from "@/shared/utils/validation";

import {
  ANTRAG_GELOESCHT_MESSAGE,
  ANTRAG_GENEHMIGT_MESSAGE,
  ERNENNUNG_BEANTRAGT_MESSAGE,
  STUFE_GEAENDERT_MESSAGE,
  ZUGANG_BEANTRAGT_MESSAGE,
  ZUGANG_ENTZOGEN_MESSAGE,
  ZUGANG_ERTEILT,
} from "./constants";
import { deleteAntrag, deleteBerechtigung, patchBerechtigung, postAntragGenehmigung, postBerechtigung } from "./mutations";
import { mapAntragAblehnungRefusal, mapAntragGenehmigungRefusal, mapEntziehenRefusal, mapErteilenRefusal, mapStufeRefusal } from "./refusals";
import {
  FLBerechtigungAntragKeyPayloadSchema,
  FLBerechtigungKeyPayloadSchema,
  FLPatchBerechtigungPayloadSchema,
  FLPostBerechtigungPayloadSchema,
} from "./schemas";

import type { FLPostGrantPayload } from "@/core/generated/client/types";
import type { ActionResult } from "@/shared/types/types";
import type { FLBerechtigungAntragKeyPayload, FLBerechtigungKeyPayload, FLPatchGrantPayload } from "./schemas";

/**
 * The enrolment's five-minute window rather than the step-up's: a
 * grant and a promotion outlive the session making them, and a revoke is the lockout lever.
 */
const ZUGANG_STEP_UP = { stepUp: "enrolment" } as const;

export async function postBerechtigungAction(
  rawPayload: FLPostGrantPayload,
): Promise<ActionResult<{ created_id: string; beantragt: boolean }>> {
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

    const { created_id, requested: beantragt } = postOperation;
    // Ends no session: one made before the grant administers nothing, every guard holding it against the
    // grant's own time on every request.

    return { success: true, created_id, beantragt, message: beantragt ? ZUGANG_BEANTRAGT_MESSAGE : ZUGANG_ERTEILT };
  });
}

/** A grant another administrator has already revoked answers 404, which the shared reader words as the reload it is. */
export async function deleteBerechtigungAction(rawPayload: FLBerechtigungKeyPayload): Promise<ActionResult> {
  return runAdminMutation("deleteBerechtigungAction", ZUGANG_STEP_UP, async () => {
    const validated = FLBerechtigungKeyPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return { success: false, error: VALIDATION_FAILED, fieldErrors: toFieldErrors(validated.error) };
    }

    try {
      await deleteBerechtigung(validated.data);
    } catch (error) {
      const refusal = mapEntziehenRefusal(error);
      if (refusal) return refusalResult(refusal);
      throw error;
    }

    return { success: true, message: ZUGANG_ENTZOGEN_MESSAGE };
  });
}

/**
 * An owner's promotion, demotion or step-down. Ends no session: the tier is read on every request,
 * so the next one already holds the new tier.
 */
export async function patchBerechtigungAction(rawPayload: FLPatchGrantPayload): Promise<ActionResult<{ beantragt: boolean }>> {
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

    if (patchOperation.requested) return { success: true, beantragt: true, message: ERNENNUNG_BEANTRAGT_MESSAGE };

    // Done whether it moved the tier or found it there: a repeated press names the tier the grant holds.
    return { success: true, beantragt: false, message: STUFE_GEAENDERT_MESSAGE[validated.data.verwaltung] };
  });
}

/** Another administrator's approval of a request: the grant or the promotion it asked for takes effect in this press. */
export async function genehmigeAntragAction(rawPayload: FLBerechtigungAntragKeyPayload): Promise<ActionResult> {
  // The grant's own window: the approval is the grant or the promotion it asked for.
  return runAdminMutation("genehmigeAntragAction", ZUGANG_STEP_UP, async () => {
    const validated = FLBerechtigungAntragKeyPayloadSchema.safeParse(rawPayload);

    if (!validated.success) return { success: false, error: VALIDATION_FAILED, fieldErrors: toFieldErrors(validated.error) };

    try {
      await postAntragGenehmigung(validated.data);
    } catch (error) {
      const refusal = mapAntragGenehmigungRefusal(error);
      if (refusal !== null) return { success: false, error: refusal };
      throw error;
    }

    return { success: true, message: ANTRAG_GENEHMIGT_MESSAGE };
  });
}

/**
 * A request's refusal by whoever may approve it, or its withdrawal by whoever made it. The step-up's window, as the
 * backend's: it changes nobody's access, so nothing outlives the session making it, and it announces nothing.
 */
export async function lehneAntragAbAction(rawPayload: FLBerechtigungAntragKeyPayload): Promise<ActionResult> {
  return runAdminMutation("lehneAntragAbAction", { stepUp: true }, async () => {
    const validated = FLBerechtigungAntragKeyPayloadSchema.safeParse(rawPayload);

    if (!validated.success) return { success: false, error: VALIDATION_FAILED, fieldErrors: toFieldErrors(validated.error) };

    try {
      await deleteAntrag(validated.data);
    } catch (error) {
      const refusal = mapAntragAblehnungRefusal(error);
      if (refusal !== null) return { success: false, error: refusal };
      throw error;
    }

    return { success: true, message: ANTRAG_GELOESCHT_MESSAGE };
  });
}
