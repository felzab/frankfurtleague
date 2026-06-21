"use server";

import { auth } from "@/core/auth";
import { patchAdminSpielData } from "./mutations";
import { updateTag } from "next/cache";
import type { FormState } from "@/shared/types";
import { AdminPatchSpielDataPayloadSchema } from "./schemas";

export async function patchAdminSpielDataAction(prevState: FormState, rawPayload: unknown): Promise<FormState> {
  const session = await auth();
  if (!session || session?.user?.role !== "admin") {
    return { success: false, error: "Access Denied: Admin privileges missing" };
  }

  const validated = AdminPatchSpielDataPayloadSchema.safeParse(rawPayload);

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
