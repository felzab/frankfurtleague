"use server";

import { refusalResult, runAdminMutation } from "@/shared/utils/adminMutation";
import { toFieldErrors, VALIDATION_FAILED } from "@/shared/utils/validation";

import { eintragenSpielbestaetigung, verwerfenSpielbestaetigung } from "./mutations";
import { FLSpielbestaetigungEintragenPayloadSchema, FLSpielbestaetigungVerwerfenPayloadSchema } from "./schemas";
import { mapSpielbestaetigungAdminRefusal } from "./utils";

import type { ActionResult } from "@/shared/types/types";
import type { FLSpielbestaetigungEnterPayload, FLSpielbestaetigungVerwerfenPayload } from "./schemas";

/**
 * A Zusage recorded on a party's behalf, after the league heard it some other way. A step-up write with no undo:
 * nothing reverses an answer. `spiele` drops because a settle can complete the pair the public card's verdict reads.
 */
export async function eintragenSpielbestaetigungAction(rawPayload: FLSpielbestaetigungEnterPayload): Promise<ActionResult> {
  return runAdminMutation("eintragenSpielbestaetigungAction", { stepUp: true }, async () => {
    const validated = FLSpielbestaetigungEintragenPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return { success: false, error: VALIDATION_FAILED, fieldErrors: toFieldErrors(validated.error) };
    }

    try {
      await eintragenSpielbestaetigung(validated.data);
    } catch (error) {
      const refusal = mapSpielbestaetigungAdminRefusal(error);
      if (refusal !== null) return refusalResult(refusal);
      throw error;
    }

    return { success: true, message: "Die Zusage steht als Antwort der Verwaltung der Liga." };
  });
}

/**
 * Closes a club's decline whose proposal the league will not take; the decline stays the record, and the club is not
 * asked again about this Ansetzung. `spiele` drops because the closed row leaves the rows the public verdict counts.
 * Where the day is to come the discard owes the club its notice that the date stands, which the drain behind the
 * response sends at once.
 */
export async function verwerfenSpielbestaetigungAction(rawPayload: FLSpielbestaetigungVerwerfenPayload): Promise<ActionResult> {
  return runAdminMutation("verwerfenSpielbestaetigungAction", { stepUp: true }, async () => {
    const validated = FLSpielbestaetigungVerwerfenPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return { success: false, error: VALIDATION_FAILED, fieldErrors: toFieldErrors(validated.error) };
    }

    try {
      await verwerfenSpielbestaetigung(validated.data);
    } catch (error) {
      const refusal = mapSpielbestaetigungAdminRefusal(error);
      if (refusal !== null) return refusalResult(refusal);
      throw error;
    }

    return { success: true, message: "Der Termin bleibt, wie er ist." };
  });
}
