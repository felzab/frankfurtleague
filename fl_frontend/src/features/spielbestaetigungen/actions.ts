"use server";

import { refusalResult, runAdminMutation } from "@/shared/utils/adminMutation";
import { toFieldErrors, VALIDATION_FAILED } from "@/shared/utils/validation";

import { eintragenSpielbestaetigung, verwerfenSpielbestaetigung } from "./mutations";
import { FLSpielbestaetigungEintragenPayloadSchema, FLSpielbestaetigungVerwerfenPayloadSchema } from "./schemas";
import { mapSpielbestaetigungAdminRefusal } from "./utils";

import type { ActionResult } from "@/shared/types/types";
import type { FLSpielbestaetigung, FLSpielbestaetigungEintragenPayload, FLSpielbestaetigungVerwerfenPayload } from "./schemas";

/**
 * A Zusage recorded on a party's behalf, after the league heard it some other way. A step-up write with no undo:
 * nothing reverses an answer. `spiele` drops because a settle can complete the pair the public card's verdict reads.
 */
export async function eintragenSpielbestaetigungAction(
  rawPayload: FLSpielbestaetigungEintragenPayload,
): Promise<ActionResult<{ updated_document?: FLSpielbestaetigung }>> {
  return runAdminMutation("eintragenSpielbestaetigungAction", { stepUp: true }, async () => {
    const validated = FLSpielbestaetigungEintragenPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return { success: false, error: VALIDATION_FAILED, fieldErrors: toFieldErrors(validated.error) };
    }

    let operation;
    try {
      operation = await eintragenSpielbestaetigung(validated.data);
    } catch (error) {
      const refusal = mapSpielbestaetigungAdminRefusal(error);
      if (refusal !== null) return refusalResult(refusal);
      throw error;
    }

    return { success: true, updated_document: operation.updated_document, message: "Die Zusage steht als Antwort der Verwaltung der Liga." };
  });
}

/**
 * Closes a club's decline whose proposal the league will not take; the decline stays the record, and the club is not
 * asked again about this Ansetzung. `spiele` drops because the closed row leaves the rows the public verdict counts.
 */
export async function verwerfenSpielbestaetigungAction(
  rawPayload: FLSpielbestaetigungVerwerfenPayload,
): Promise<ActionResult<{ updated_document?: FLSpielbestaetigung }>> {
  return runAdminMutation("verwerfenSpielbestaetigungAction", { stepUp: true }, async () => {
    const validated = FLSpielbestaetigungVerwerfenPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return { success: false, error: VALIDATION_FAILED, fieldErrors: toFieldErrors(validated.error) };
    }

    let operation;
    try {
      operation = await verwerfenSpielbestaetigung(validated.data);
    } catch (error) {
      const refusal = mapSpielbestaetigungAdminRefusal(error);
      if (refusal !== null) return refusalResult(refusal);
      throw error;
    }

    return { success: true, updated_document: operation.updated_document, message: "Der Termin bleibt, wie er ist." };
  });
}
