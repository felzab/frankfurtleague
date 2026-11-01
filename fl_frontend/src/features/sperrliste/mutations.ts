import { sperrlisteDeleteSperrlisteEntry, sperrlistePostSperrlisteEntry } from "@/core/generated/client/sdk";

import type { FLPostSperrlistePayload, FLPostSperrlisteResponse, FLSperrlisteWriteResponse } from "@/core/generated/client/types";
import type { FLSperrlisteKeyPayload } from "./schemas";

export async function postSperre(payload: FLPostSperrlistePayload): Promise<FLPostSperrlisteResponse> {
  return sperrlistePostSperrlisteEntry(payload);
}

// Hard, unlike every other DELETE in the admin: a ban holds nothing to retire, so the row goes.
export async function deleteSperre({ id }: FLSperrlisteKeyPayload): Promise<FLSperrlisteWriteResponse> {
  return sperrlisteDeleteSperrlisteEntry(id);
}
