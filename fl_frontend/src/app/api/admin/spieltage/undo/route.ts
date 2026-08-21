import { revalidateTag } from "next/cache";

import { APIBadStatusError } from "@/core/errors";
import { patchSpieltag } from "@/features/spieltage/mutations";
import { FLPatchSpieltagPayloadSchema } from "@/features/spieltage/schemas";
import { handleUndoRequest } from "@/shared/utils/undoRoute";

import type { NextRequest } from "next/server";

/** The refusals a replay can meet, in German — none of them has a field to land on from a toast. */
const REPLAY_REFUSALS: Record<string, string> = {
  "REQ-DATE-002": "Der ursprüngliche Zeitraum liegt nicht mehr im Zeitraum der Saison. Die Änderung steht weiterhin.",
  "REQ-DATE-003": "Mindestens ein Spiel dieses Spieltags liegt außerhalb des ursprünglichen Zeitraums. Die Änderung steht weiterhin.",
};

export async function POST(request: NextRequest) {
  return handleUndoRequest(request, {
    mutationName: "undoAdminSpieltagEdit",
    schema: FLPatchSpieltagPayloadSchema,
    restore: async (payload) => {
      let operation;
      try {
        operation = await patchSpieltag(payload);
      } catch (error) {
        const code = error instanceof APIBadStatusError && error.statusCode === 409 ? error.serverErrorCode : undefined;
        const refusal = code == null ? undefined : REPLAY_REFUSALS[code];
        if (refusal !== undefined) return refusal;
        throw error;
      }

      return operation.acknowledged ? undefined : "Die Rücknahme wurde abgebrochen. Prüfe den Spieltag.";
    },
    invalidate: () => {
      revalidateTag("spieltage", { expire: 0 });
    },
  });
}
