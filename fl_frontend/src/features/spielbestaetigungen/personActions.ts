"use server";

import { CustomObjectIdStringSchema } from "@/shared/schemas";
import { refusalResult } from "@/shared/utils/adminMutation";
import { runPersonRecordMutation } from "@/shared/utils/personMutation";
import { toFieldErrors, VALIDATION_FAILED } from "@/shared/utils/validation";

import { postSpielbestaetigungAnswer } from "./mutations";
import { SchiedsrichterAbsageSchema } from "./schemas";
import { ABSAGE_GESPEICHERT, mapSchiedsrichterAnswerRefusal, ZUSAGE_GESPEICHERT } from "./utils";

import type { ActionResult } from "@/shared/types/types";
import type { SchiedsrichterAbsage } from "./schemas";

/**
 * One answer, claiming the referee's own row rather than a seat: the backend authorises the row against the
 * referee records the signed-in address holds. `sende` is the request, written at each action so the action
 * names the call it makes.
 */
async function answer<Z extends "zugesagt" | "abgelehnt">(
  sende: () => Promise<unknown>,
  state: Z,
  message: string,
): Promise<ActionResult<{ zustand: Z }>> {
  try {
    await sende();
  } catch (error) {
    const refusal = mapSchiedsrichterAnswerRefusal(error);
    if (refusal !== null) return { ...refusalResult(refusal), unplacedError: refusal.unplacedError };
    throw error;
  }

  return { success: true, message: message, zustand: state };
}

/** The referee agrees to officiate the fixture their row asks about. */
export async function zusagenSpielbestaetigungAction(spielbestaetigungId: string): Promise<ActionResult<{ zustand: "zugesagt" }>> {
  return runPersonRecordMutation("zusagenSpielbestaetigungAction", async () => {
    const id = CustomObjectIdStringSchema.safeParse(spielbestaetigungId);
    if (!id.success) return { success: false, error: VALIDATION_FAILED };

    return answer(() => postSpielbestaetigungAnswer(id.data, { answer: "zugesagt", reason: null }), "zugesagt", ZUSAGE_GESPEICHERT);
  });
}

/** The referee declines, with their reason; the backend empties the fixture's slot in the same write. */
export async function absagenSpielbestaetigungAction(
  spielbestaetigungId: string,
  rawPayload: SchiedsrichterAbsage,
): Promise<ActionResult<{ zustand: "abgelehnt" }>> {
  return runPersonRecordMutation("absagenSpielbestaetigungAction", async () => {
    const id = CustomObjectIdStringSchema.safeParse(spielbestaetigungId);
    const validated = SchiedsrichterAbsageSchema.safeParse(rawPayload);

    if (!id.success || !validated.success) {
      return { success: false, error: VALIDATION_FAILED, fieldErrors: validated.success ? undefined : toFieldErrors(validated.error) };
    }

    const reason = validated.data.reason;
    return answer(() => postSpielbestaetigungAnswer(id.data, { answer: "declined", reason }), "abgelehnt", ABSAGE_GESPEICHERT);
  });
}
