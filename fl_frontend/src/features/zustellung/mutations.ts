import { apiClient } from "@/core/api";

import { FLZustellungResponseSchema } from "./schemas";

import type {
  FLZustellungAbgewiesenPayload,
  FLZustellungAngenommenPayload,
  FLZustellungEreignisPayload,
  FLZustellungResponse,
} from "./schemas";

// Named apart from `fl_frontend/src/features/bewerbungen/mutations.ts :: meldeZustellungAngenommen`
// rather than replacing it: that endpoint addresses an application by its seats, and one name over
// two endpoints would hand a caller either by import order.
/** The system tier, not admin: a delivery event carries no session, and the sites reporting an acceptance include public route handlers and a timer. */
export async function meldeZielZustellungAngenommen(payload: FLZustellungAngenommenPayload): Promise<FLZustellungResponse> {
  return apiClient<FLZustellungResponse>("/zustellung/angenommen", FLZustellungResponseSchema, {
    method: "POST",
    authType: "system",
    body: JSON.stringify(payload),
  });
}

/** The send the provider refused, which mints nothing: without this call that address is known to be unreachable at no tier but this process's own log. */
export async function meldeZielZustellungAbgewiesen(payload: FLZustellungAbgewiesenPayload): Promise<FLZustellungResponse> {
  return apiClient<FLZustellungResponse>("/zustellung/abgewiesen", FLZustellungResponseSchema, {
    method: "POST",
    authType: "system",
    body: JSON.stringify(payload),
  });
}

/**
 * Its own endpoint beside the acceptance above, because the two are judged differently: an
 * acceptance is stopped by a newer acceptance alone, and an event only where it beats what the record holds.
 */
export async function meldeZielZustellEreignis(payload: FLZustellungEreignisPayload): Promise<FLZustellungResponse> {
  return apiClient<FLZustellungResponse>("/zustellung", FLZustellungResponseSchema, {
    method: "POST",
    authType: "system",
    body: JSON.stringify(payload),
  });
}
