import { apiClient } from "@/core/api";

import { FLSpielberichtAdminResponseSchema, FLSpielberichtSchiedsrichterResponseSchema } from "./schemas";

import type { FLSpielberichtAdminResponse, FLSpielberichtPayload, FLSpielberichtSchiedsrichterResponse } from "./schemas";

/** The booked referee's whole block, first write and correction alike: the backend keeps the first submission's stamp. */
export async function putSpielbericht(spielId: string, payload: FLSpielberichtPayload): Promise<FLSpielberichtSchiedsrichterResponse> {
  return apiClient<FLSpielberichtSchiedsrichterResponse>(`/spielberichte/${spielId}/bericht`, FLSpielberichtSchiedsrichterResponseSchema, {
    method: "PUT",
    authType: "admin",
    body: JSON.stringify(payload),
  });
}

export async function patchAdminSpielbericht(spielId: string, payload: FLSpielberichtPayload): Promise<FLSpielberichtAdminResponse> {
  return apiClient<FLSpielberichtAdminResponse>(`/spielberichte/${spielId}`, FLSpielberichtAdminResponseSchema, {
    method: "PATCH",
    authType: "admin",
    body: JSON.stringify(payload),
  });
}
