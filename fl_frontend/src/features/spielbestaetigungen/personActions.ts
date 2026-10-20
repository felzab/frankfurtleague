"use server";

import { CustomObjectIdStringSchema } from "@/shared/schemas";
import { invalidatesOnWrite, refusalResult } from "@/shared/utils/adminMutation";
import { runPersonRecordMutation } from "@/shared/utils/personMutation";
import { toFieldErrors, VALIDATION_FAILED } from "@/shared/utils/validation";

import { postSpielbestaetigungAntwort } from "./mutations";
import { SchiedsrichterAbsageSchema } from "./schemas";
import { ABSAGE_GESPEICHERT, mapSchiedsrichterAntwortRefusal, ZUSAGE_GESPEICHERT } from "./utils";

import type { ActionResult } from "@/shared/types/types";
import type { SchiedsrichterAbsage } from "./schemas";

/**
 * One answer, claiming the referee's own row rather than a seat: the backend authorises the row against the
 * referee records the signed-in address holds. `sende` is the request, written at each action so the action
 * names the call it makes.
 */
async function antworten<Z extends "zugesagt" | "abgelehnt">(
  sende: () => Promise<unknown>,
  zustand: Z,
  message: string,
): Promise<ActionResult<{ zustand: Z }>> {
  // An acceptance is what makes the fixture's referee servable at all, and a decline empties the slot: either left to
  // the fixtures read's hours-long cache would hide a referee who agreed, or show one who declined.
  invalidatesOnWrite("spiele");
  try {
    await sende();
  } catch (error) {
    const refusal = mapSchiedsrichterAntwortRefusal(error);
    if (refusal !== null) return { ...refusalResult(refusal), unplacedError: refusal.unplacedError };
    throw error;
  }

  return { success: true, message: message, zustand: zustand };
}

/** The referee agrees to officiate the fixture their row asks about. */
export async function zusagenSpielbestaetigungAction(spielbestaetigungId: string): Promise<ActionResult<{ zustand: "zugesagt" }>> {
  return runPersonRecordMutation("zusagenSpielbestaetigungAction", async () => {
    const id = CustomObjectIdStringSchema.safeParse(spielbestaetigungId);
    if (!id.success) return { success: false, error: VALIDATION_FAILED };

    return antworten(() => postSpielbestaetigungAntwort(id.data, { antwort: "zugesagt", begruendung: null }), "zugesagt", ZUSAGE_GESPEICHERT);
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

    const begruendung = validated.data.begruendung;
    return antworten(
      () => postSpielbestaetigungAntwort(id.data, { antwort: "abgelehnt", begruendung: begruendung }),
      "abgelehnt",
      ABSAGE_GESPEICHERT,
    );
  });
}
