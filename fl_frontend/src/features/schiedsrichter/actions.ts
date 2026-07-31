"use server";

import { updateTag } from "next/cache";

import { getAdminSession } from "@/core/auth";
import { toFieldErrors } from "@/shared/utils/validation";

import { deleteSchiedsrichter, patchSchiedsrichter, postSchiedsrichter } from "./mutations";
import { FLDeleteSchiedsrichterPayloadSchema, FLPatchSchiedsrichterPayloadSchema, FLPostSchiedsrichterPayloadSchema } from "./schemas";

import type { FieldErrors } from "@/shared/utils/validation";
import type { FLDeleteSchiedsrichterPayload, FLPatchSchiedsrichterPayload, FLPostSchiedsrichterPayload, FLSchiedsrichter } from "./schemas";

export async function postSchiedsrichterAction(
  rawPayload: FLPostSchiedsrichterPayload,
): Promise<{ success: boolean; created_id?: string; message?: string; error?: string; fieldErrors?: FieldErrors }> {
  if (!(await getAdminSession())) {
    return { success: false, error: "Access Denied: Admin privileges missing" };
  }

  const validated = FLPostSchiedsrichterPayloadSchema.safeParse(rawPayload);

  if (!validated.success) {
    return {
      success: false,
      error: "Bitte überprüfe deine Eingaben!",
      fieldErrors: toFieldErrors(validated.error),
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

export async function patchSchiedsrichterAction(
  rawPayload: FLPatchSchiedsrichterPayload,
): Promise<{ success: boolean; updated_document?: FLSchiedsrichter; message?: string; error?: string; fieldErrors?: FieldErrors }> {
  if (!(await getAdminSession())) {
    return { success: false, error: "Access Denied: Admin privileges missing" };
  }

  const validated = FLPatchSchiedsrichterPayloadSchema.safeParse(rawPayload);

  if (!validated.success) {
    return {
      success: false,
      error: "Bitte überprüfe deine Eingaben!",
      fieldErrors: toFieldErrors(validated.error),
    };
  }

  const postOperation = await patchSchiedsrichter(validated.data);
  if (!postOperation.acknowledged) {
    return { success: false, error: "Beim Bearbeiten der Schiedsrichter-Daten ist ein unerwarteter Fehler aufgetreten" };
  }

  updateTag("schiedsrichter");
  updateTag("spiele");

  return {
    success: Boolean(postOperation.acknowledged),
    updated_document: postOperation.updated_document,
    message: "Schiedsrichter erfolgreich bearbeitet!",
  };
}

// This is a soft delete
export async function deleteSchiedsrichterAction(
  rawPayload: FLDeleteSchiedsrichterPayload,
): Promise<{ success: boolean; updated_document?: FLSchiedsrichter; message?: string; error?: string; fieldErrors?: FieldErrors }> {
  if (!(await getAdminSession())) {
    return { success: false, error: "Access Denied: Admin privileges missing" };
  }

  const validated = FLDeleteSchiedsrichterPayloadSchema.safeParse(rawPayload);

  if (!validated.success) {
    return {
      success: false,
      error: "Bitte überprüfe deine Eingaben!",
      fieldErrors: toFieldErrors(validated.error),
    };
  }

  const postOperation = await deleteSchiedsrichter(validated.data);
  if (!postOperation.acknowledged) {
    return { success: false, error: "Beim Löschen der Schiedsrichter-Daten ist ein unerwarteter Fehler aufgetreten" };
  }

  updateTag("schiedsrichter");

  return {
    success: Boolean(postOperation.acknowledged),
    updated_document: postOperation.updated_document,
    message: "Schiedsrichter erfolgreich gelöscht!",
  };
}
