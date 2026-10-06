import { patchSpieltag } from "@/features/spieltage/mutations";
import { SPIELTAG_REPLAY_REFUSALS } from "@/features/spieltage/refusals";
import { FLPatchSpieltagPayloadSchema } from "@/features/spieltage/schemas";
import { handleUndoRequest, refusedReplay } from "@/shared/utils/undoRoute";

import type { NextRequest } from "next/server";

export async function POST(request: NextRequest) {
  return handleUndoRequest(request, {
    mutationName: "undoAdminSpieltagEdit",
    schema: FLPatchSpieltagPayloadSchema,
    restore: async (payload) => {
      let operation;
      try {
        operation = await patchSpieltag(payload);
      } catch (error) {
        return refusedReplay(error, SPIELTAG_REPLAY_REFUSALS);
      }

      return operation.acknowledged ? {} : { unclear: "Die Rücknahme wurde abgebrochen. Prüfe den Spieltag." };
    },
    tags: () => ["spieltage"],
  });
}
