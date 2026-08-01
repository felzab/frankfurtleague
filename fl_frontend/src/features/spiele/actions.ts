"use server";

import { updateTag } from "next/cache";

import { z } from "zod";

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
export async function patchAdminSpielDataAction(rawPayload: unknown, rawSaisonId: unknown): Promise<NonNullable<FormState>> {
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

  // The base tags are not redundant with the granular ones below, and must stay. Since BE-1 the
  // default read path sends no `saison_id` at all, so the most common cache entries carry only
  // `spiele` / `teams`; invalidating by season alone would leave exactly those entries stale.
  updateTag("spiele");
  updateTag("teams");

  // Season comes from the loaded spiel, never from the patch body -- the backend's
  // PatchSpielDataPayload does not declare `saison_id` and Pydantic would silently drop it. A spiel
  // that somehow lacks a valid one still gets the base invalidation above, so the edit is never
  // rejected over a cache concern.
  const saisonId = z.string().length(4).safeParse(rawSaisonId);
  if (saisonId.success) {
    updateTag(`spiele:saison_id:${saisonId.data}`);
    updateTag(`teams:saison_id:${saisonId.data}`);
  }

  return { success: Boolean(patch_operation.acknowledged), message: "Die Spieldaten wurden erfolgreich aktualisiert" };
}
