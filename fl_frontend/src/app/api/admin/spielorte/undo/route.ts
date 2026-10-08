import { patchSpielort } from "@/features/spielorte/mutations";
import { SPIELORT_REPLAY_REFUSALS } from "@/features/spielorte/refusals";
import { FLPatchSpielortPayloadSchema } from "@/features/spielorte/schemas";
import { handleUndoRequest, refusedReplay } from "@/shared/utils/undoRoute";

import type { NextRequest } from "next/server";

export async function POST(request: NextRequest) {
  return handleUndoRequest(request, {
    mutationName: "undoAdminSpielortEdit",
    schema: FLPatchSpielortPayloadSchema,
    restore: async (payload) => {
      let operation;
      try {
        operation = await patchSpielort(payload);
      } catch (error) {
        return refusedReplay(error, SPIELORT_REPLAY_REFUSALS);
      }

      return operation.acknowledged ? {} : { unclear: "Die Rücknahme wurde abgebrochen. Prüfe die Spielortdaten." };
    },
    // `spiele` alone: the rename fans out into cached fixtures embedding this row (`docs/frontend/spec.md` §1.4).
    tags: () => ["spiele"],
  });
}
