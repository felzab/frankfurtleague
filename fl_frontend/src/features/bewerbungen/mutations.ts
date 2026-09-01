import { apiClient } from "@/core/api";

import { FLAblehnenBewerbungResponseSchema, FLAnnehmenBewerbungResponseSchema, FLPostBewerbungResponseSchema } from "./schemas";

import type {
  FLAblehnenBewerbungPayload,
  FLAblehnenBewerbungResponse,
  FLAnnehmenBewerbungPayload,
  FLAnnehmenBewerbungResponse,
  FLPostBewerbungPayload,
  FLPostBewerbungResponse,
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

/**
 * Records one school's application. **The only write on this slice a visitor reaches**, and the only
 * one made at the base tier: the endpoint is public, and over-declaring the tier succeeds silently.
 */
export async function postBewerbung(payload: FLPostBewerbungPayload): Promise<FLPostBewerbungResponse> {
  return apiClient<FLPostBewerbungResponse>("/bewerbungen", FLPostBewerbungResponseSchema, {
    method: "POST",
    authType: "base",
    body: JSON.stringify(payload),
  });
}
