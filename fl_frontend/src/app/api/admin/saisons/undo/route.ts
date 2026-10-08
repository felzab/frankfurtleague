import { patchSaison } from "@/features/saisons/mutations";
import { SAISON_REPLAY_REFUSALS } from "@/features/saisons/refusals";
import { FLPatchSaisonPayloadSchema } from "@/features/saisons/schemas";
import { handleUndoRequest, refusedReplay } from "@/shared/utils/undoRoute";

import type { NextRequest } from "next/server";

export async function POST(request: NextRequest) {
  return handleUndoRequest(request, {
    mutationName: "undoAdminSaisonEdit",
    schema: FLPatchSaisonPayloadSchema,
    restore: async (payload) => {
      let operation;
      try {
        operation = await patchSaison(payload);
      } catch (error) {
        return refusedReplay(error, SAISON_REPLAY_REFUSALS);
      }

      return operation.acknowledged ? {} : { unclear: "Die Rücknahme wurde abgebrochen. Prüfe die Saisondaten." };
    },
    tags: () => ["saisons", "teams"],
  });
}
