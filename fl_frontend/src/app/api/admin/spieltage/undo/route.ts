import { revalidateTag } from "next/cache";

import { APIBadStatusError } from "@/core/errors";
import { patchSpieltag } from "@/features/spieltage/mutations";
import { FLPatchSpieltagPayloadSchema } from "@/features/spieltage/schemas";
import { handleUndoRequest } from "@/shared/utils/undoRoute";

import type { NextRequest } from "next/server";

/** The refusals a replay can meet, in German — none of them has a field to land on from a toast. */
const REPLAY_REFUSALS: Record<string, string> = {
  "REQ-DATE-002": "Der ursprüngliche Zeitraum liegt nicht mehr im Zeitraum der Saison.",
  "REQ-DATE-003": "Mindestens ein Spiel dieses Spieltags liegt außerhalb des ursprünglichen Zeitraums.",
  "REQ-DATE-008":
    "Der ursprüngliche Beginn dieses Spieltags passt nicht mehr in die Reihenfolge der Spieltage seiner Phase, die schon einen Zeitraum haben.",
};

/** The second half of every refusal above: a cause alone leaves the admin unsure what the matchday now holds. */
const CHANGE_STANDS = "Die Änderung steht weiterhin.";

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
        // The code is an unvalidated wire string, and an unguarded lookup reaches `Object.prototype`: `toString` selects a function.
        const refusal = code == null || !Object.hasOwn(REPLAY_REFUSALS, code) ? undefined : REPLAY_REFUSALS[code];
        if (refusal === undefined) throw error;

        return `${refusal} ${CHANGE_STANDS}`;
      }

      return operation.acknowledged ? undefined : "Die Rücknahme wurde abgebrochen. Prüfe den Spieltag.";
    },
    invalidate: () => {
      revalidateTag("spieltage", { expire: 0 });
    },
  });
}
