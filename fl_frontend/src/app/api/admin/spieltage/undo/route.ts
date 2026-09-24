import { revalidateTag } from "next/cache";

import { patchSpieltag } from "@/features/spieltage/mutations";
import { FLPatchSpieltagPayloadSchema } from "@/features/spieltage/schemas";
import { KONFLIKT_MIT_BESTEHENDEM } from "@/shared/utils/actionError";
import { handleUndoRequest, refusedReplay } from "@/shared/utils/undoRoute";

import type { NextRequest } from "next/server";

/** The refusals a replay can meet, in German — none of them has a field to land on from a toast. */
const REPLAY_REFUSALS: Record<string, string> = {
  "REQ-DATE-002": "Der ursprüngliche Zeitraum liegt nicht mehr im Zeitraum der Saison.",
  "REQ-DATE-003": "Mindestens ein Spiel dieses Spieltags liegt außerhalb des ursprünglichen Zeitraums.",
  "REQ-DATE-008":
    "Der ursprüngliche Beginn dieses Spieltags passt nicht mehr in die Reihenfolge der Spieltage seiner Phase, die schon einen Zeitraum haben.",
  "DB-COMMON-002": KONFLIKT_MIT_BESTEHENDEM,
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
        return refusedReplay(error, REPLAY_REFUSALS);
      }

      return operation.acknowledged ? {} : { refusal: "Die Rücknahme wurde abgebrochen. Prüfe den Spieltag." };
    },
    invalidate: () => {
      revalidateTag("spieltage", { expire: 0 });
    },
  });
}
