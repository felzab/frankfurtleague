import { revalidateTag } from "next/cache";

import { patchSpielort } from "@/features/spielorte/mutations";
import { FLPatchSpielortPayloadSchema } from "@/features/spielorte/schemas";
import { handleUndoRequest, replayRefusal } from "@/shared/utils/undoRoute";

import type { NextRequest } from "next/server";

const REPLAY_REFUSALS: Record<string, string> = {
  // The unique index's refusal in the shared reader's own sentence, which alone says nothing of the change.
  "DB-COMMON-002": "Der Eintrag steht im Konflikt mit einem, den es schon gibt.",
};

/** The second half of every refusal above: a cause alone leaves the admin unsure what the venue now holds. */
const CHANGE_STANDS = "Die Änderung steht weiterhin.";

export async function POST(request: NextRequest) {
  return handleUndoRequest(request, {
    mutationName: "undoAdminSpielortEdit",
    schema: FLPatchSpielortPayloadSchema,
    restore: async (payload) => {
      let operation;
      try {
        operation = await patchSpielort(payload);
      } catch (error) {
        const refusal = replayRefusal(error, REPLAY_REFUSALS);
        if (refusal === undefined) throw error;

        return { refusal: `${refusal} ${CHANGE_STANDS}` };
      }

      return operation.acknowledged ? {} : { refusal: "Die Rücknahme wurde abgebrochen. Prüfe die Spielortdaten." };
    },
    // `spiele` alone: the rename fans out into cached fixtures embedding this row (`docs/frontend/spec.md` §1.4).
    invalidate: () => {
      revalidateTag("spiele", { expire: 0 });
    },
  });
}
