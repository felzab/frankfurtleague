import { revalidateTag } from "next/cache";

import { patchSpielort } from "@/features/spielorte/mutations";
import { FLPatchSpielortPayloadSchema } from "@/features/spielorte/schemas";
import { KONFLIKT_MIT_BESTEHENDEM } from "@/shared/utils/actionError";
import { handleUndoRequest, refusedReplay } from "@/shared/utils/undoRoute";

import type { NextRequest } from "next/server";

const REPLAY_REFUSALS: Record<string, string> = {
  "DB-COMMON-002": KONFLIKT_MIT_BESTEHENDEM,
};

export async function POST(request: NextRequest) {
  return handleUndoRequest(request, {
    mutationName: "undoAdminSpielortEdit",
    schema: FLPatchSpielortPayloadSchema,
    restore: async (payload) => {
      let operation;
      try {
        operation = await patchSpielort(payload);
      } catch (error) {
        return refusedReplay(error, REPLAY_REFUSALS);
      }

      return operation.acknowledged ? {} : { refusal: "Die Rücknahme wurde abgebrochen. Prüfe die Spielortdaten." };
    },
    // `spiele` alone: the rename fans out into cached fixtures embedding this row (`docs/frontend/spec.md` §1.4).
    invalidate: () => {
      revalidateTag("spiele", { expire: 0 });
    },
  });
}
