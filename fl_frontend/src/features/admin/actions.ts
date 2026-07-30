"use server";

import { updateTag } from "next/cache";

import { getAdminSession } from "@/core/auth";

import { patchAdminSpielData } from "./mutations";
import { FLPatchSpielDataPayloadSchema } from "./schemas";

import type { FormState } from "@/shared/types/types";

export async function patchAdminSpielDataAction(prevState: FormState, rawPayload: unknown): Promise<FormState> {
  if (!(await getAdminSession())) {
    return { success: false, error: "Access Denied: Admin privileges missing" };
  }

  const validated = FLPatchSpielDataPayloadSchema.safeParse(rawPayload);

  if (!validated.success) {
    return {
      success: false,
      error: "Bitte überprüfe deine Eingaben!",
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
