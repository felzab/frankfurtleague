"use server";

import { updateTag } from "next/cache";

import { getAdminSession } from "@/core/auth";
import { toFieldErrors } from "@/shared/utils/validation";

import { patchAdminSpielData } from "./mutations";
import { FLPatchSpielDataPayloadSchema } from "./schemas";

import type { FormState } from "@/shared/types/types";

/**
 * No `prevState` parameter: the caller awaits this inside a transition rather than through
 * `useActionState`. That hook exists to hold state you *render*; this form only pipes the result
 * into a toast and closes, so the reducer signature bought nothing and cost an effect. Matches
 * `patchSpielortAction` and the rest of the admin write path.
 */
export async function patchAdminSpielDataAction(rawPayload: unknown): Promise<NonNullable<FormState>> {
  if (!(await getAdminSession())) {
    return { success: false, error: "Access Denied: Admin privileges missing" };
  }

  const validated = FLPatchSpielDataPayloadSchema.safeParse(rawPayload);

  if (!validated.success) {
    return {
      success: false,
      error: "Bitte überprüfe deine Eingaben!",
      fieldErrors: toFieldErrors(validated.error),
    };
  }

  const patch_operation = await patchAdminSpielData(validated.data);
  if (!patch_operation.acknowledged) {
    return { success: false, error: "Bei der Aktualisierung der Spieldaten ist ein unerwarteter Fehler aufgetreten" };
  }

  updateTag("spiele");
  updateTag("teams");

  return { success: Boolean(patch_operation.acknowledged), message: "Die Spieldaten wurden erfolgreich aktualisiert" };
}
