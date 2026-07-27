"use server";

import { updateTag } from "next/cache";

import { auth } from "@/core/auth";

import { postSchiedsrichter } from "./mutations";
import { FLPostSchiedsrichterPayloadSchema } from "./schemas";

import type { FLPostSchiedsrichterPayload } from "./schemas";

export async function postSchiedsrichterAction(
  rawPayload: FLPostSchiedsrichterPayload,
): Promise<{ success: boolean; created_id?: string; message?: string; error?: string }> {
  const session = await auth();
  if (!session || session?.user?.role !== "admin") {
    return { success: false, error: "Access Denied: Admin privileges missing" };
  }

  const validated = FLPostSchiedsrichterPayloadSchema.safeParse(rawPayload);

  if (!validated.success) {
    return {
      success: false,
      error: "Bitte überprüfe deine Eingaben!",
    };
  }

  const postOperation = await postSchiedsrichter(validated.data);
  if (!postOperation.acknowledged) {
    return { success: false, error: "Beim Anlegen des neuen Schiedsrichters ist ein unerwarteter Fehler aufgetreten" };
  }

  updateTag("schiedsrichter");

  return {
    success: Boolean(postOperation.acknowledged),
    created_id: postOperation.created_id,
    message: "Schiedsrichter erfolgreich angelegt!",
  };
}
