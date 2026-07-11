"use server";

import { updateTag } from "next/cache";

import { auth } from "@/core/auth";

import { postSpielort } from "./mutations";
import { FLNewSpielortPayloadSchema } from "./schemas";

import type { FLNewSpielortPayload } from "./schemas";

export async function postSpielortAction(
  rawPayload: FLNewSpielortPayload,
): Promise<{ success: boolean; created_id?: string; message?: string; error?: string }> {
  const session = await auth();
  if (!session || session?.user?.role !== "admin") {
    return { success: false, error: "Access Denied: Admin privileges missing" };
  }

  const validated = FLNewSpielortPayloadSchema.safeParse(rawPayload);

  if (!validated.success) {
    return {
      success: false,
      error: "Bitte überprüfe deine Eingaben!",
    };
  }

  const postOperation = await postSpielort(validated.data);
  if (!postOperation.acknowledged) {
    return { success: false, error: "Beim Anlegen des neuen Spielortes ist ein unerwarteter Fehler aufgetreten" };
  }

  updateTag("spielorte");

  return { success: Boolean(postOperation.acknowledged), created_id: postOperation.created_id, message: "Spielort erfolgreich angelegt!" };
}
