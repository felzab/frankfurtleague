import { apiClient } from "@/core/api";

import { FLAblehnenBewerbungResponseSchema, FLAnnehmenBewerbungResponseSchema } from "./schemas";

import type {
  FLAblehnenBewerbungPayload,
  FLAblehnenBewerbungResponse,
  FLAnnehmenBewerbungPayload,
  FLAnnehmenBewerbungResponse,
} from "./schemas";

/**
 * Accepts the application: creates the club where the school is new, enters it into the season and
 * records the decision, in one transaction on the backend.
 *
 * The id goes in the path, never the body: the backend model refuses a body that names one.
 */
export async function annehmenBewerbung({ id, ...fields }: FLAnnehmenBewerbungPayload): Promise<FLAnnehmenBewerbungResponse> {
  return apiClient<FLAnnehmenBewerbungResponse>(`/bewerbungen/${id}/annehmen`, FLAnnehmenBewerbungResponseSchema, {
    method: "POST",
    authType: "admin",
    body: JSON.stringify(fields),
  });
}

// Moves `status` and `entscheidung` and nothing else: what the school wrote stays the record the
// decision was taken against.
export async function ablehnenBewerbung({ id, ...fields }: FLAblehnenBewerbungPayload): Promise<FLAblehnenBewerbungResponse> {
  return apiClient<FLAblehnenBewerbungResponse>(`/bewerbungen/${id}/ablehnen`, FLAblehnenBewerbungResponseSchema, {
    method: "POST",
    authType: "admin",
    body: JSON.stringify(fields),
  });
}
