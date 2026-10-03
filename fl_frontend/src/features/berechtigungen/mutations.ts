import { apiClient } from "@/core/api";

import {
  FLBerechtigungAbgleichResponseSchema,
  FLBerechtigungAngekuendigtResponseSchema,
  FLBerechtigungWriteResponseSchema,
  FLPostBerechtigungResponseSchema,
} from "./schemas";

import type {
  FLBerechtigungAbgleichResponse,
  FLBerechtigungAngekuendigtPayload,
  FLBerechtigungAngekuendigtResponse,
  FLBerechtigungKeyPayload,
  FLBerechtigungWriteResponse,
  FLPatchBerechtigungPayload,
  FLPostBerechtigungPayload,
  FLPostBerechtigungResponse,
} from "./schemas";

export async function postBerechtigung(payload: FLPostBerechtigungPayload): Promise<FLPostBerechtigungResponse> {
  return apiClient<FLPostBerechtigungResponse>("/berechtigungen", FLPostBerechtigungResponseSchema, {
    method: "POST",
    authType: "admin",
    body: JSON.stringify(payload),
  });
}

// Hard, as the ban's removal is: a revoked grant keeps nothing to restore.
export async function deleteBerechtigung({ id }: FLBerechtigungKeyPayload): Promise<FLBerechtigungWriteResponse> {
  return apiClient<FLBerechtigungWriteResponse>(`/berechtigungen/${id}`, FLBerechtigungWriteResponseSchema, {
    method: "DELETE",
    authType: "admin",
  });
}

export async function patchBerechtigung({ id, ...fields }: FLPatchBerechtigungPayload): Promise<FLBerechtigungWriteResponse> {
  return apiClient<FLBerechtigungWriteResponse>(`/berechtigungen/${id}`, FLBerechtigungWriteResponseSchema, {
    method: "PATCH",
    authType: "admin",
    body: JSON.stringify(fields),
  });
}

/**
 * The pass's claim, system tier: it writes, turning a change made in the database directly into an
 * outbox row and claiming the rows no live claim holds, so it is never marked `readOnly`.
 */
export async function postBerechtigungenAbgleich(): Promise<FLBerechtigungAbgleichResponse> {
  return apiClient<FLBerechtigungAbgleichResponse>("/berechtigungen/abgleich", FLBerechtigungAbgleichResponseSchema, {
    method: "POST",
    authType: "system",
  });
}

export async function postBerechtigungenAngekuendigt(payload: FLBerechtigungAngekuendigtPayload): Promise<FLBerechtigungAngekuendigtResponse> {
  return apiClient<FLBerechtigungAngekuendigtResponse>("/berechtigungen/abgleich/angekuendigt", FLBerechtigungAngekuendigtResponseSchema, {
    method: "POST",
    authType: "system",
    body: JSON.stringify(payload),
  });
}
