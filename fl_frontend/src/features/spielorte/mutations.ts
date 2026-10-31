import {
  spielorteDeleteSpielort,
  spielortePatchSpielort,
  spielortePostSpielort,
  spielorteReactivateSpielort,
} from "@/core/generated/client/sdk";

import type { FLCreatedResponse, FLPatchSpielortResponse, FLPostSpielortPayload } from "@/core/generated/client/types";
import type { FLPatchSpielortPayload, FLSpielortKeyPayload } from "./schemas";

export async function postSpielort(postSpielortPayload: FLPostSpielortPayload): Promise<FLCreatedResponse> {
  return spielortePostSpielort(postSpielortPayload);
}

/** The id goes in the path, never the body: the backend model refuses a body that names one. */
export async function patchSpielort({ id, ...fields }: FLPatchSpielortPayload): Promise<FLPatchSpielortResponse> {
  return spielortePatchSpielort(id, fields);
}

// Soft: the backend stamps `inactive_since` and removes nothing.
export async function deleteSpielort({ id }: FLSpielortKeyPayload): Promise<void> {
  return spielorteDeleteSpielort(id);
}

// Clearing `inactive_since` returns the venue to the picker and to every default read, which makes
// retirement a state rather than a disappearance.
export async function reactivateSpielort({ id }: FLSpielortKeyPayload): Promise<void> {
  return spielorteReactivateSpielort(id);
}
