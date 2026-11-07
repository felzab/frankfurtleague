import { banListDeleteBanListEntry, banListPostBanListEntry } from "@/core/generated/client/sdk";

import type { FLBanListWriteResponse, FLPostBanListEntryPayload, FLPostBanListEntryResponse } from "@/core/generated/client/types";
import type { FLBanListEntryKeyPayload } from "./schemas";

export async function postSperre(payload: FLPostBanListEntryPayload): Promise<FLPostBanListEntryResponse> {
  return banListPostBanListEntry(payload);
}

// Hard, unlike every other DELETE in the admin: a ban holds nothing to retire, so the row goes.
export async function deleteSperre({ id }: FLBanListEntryKeyPayload): Promise<FLBanListWriteResponse> {
  return banListDeleteBanListEntry(id);
}
