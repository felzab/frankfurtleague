import { revalidateTag } from "next/cache";

import { APIBadStatusError } from "@/core/errors";
import { patchSchiedsrichter } from "@/features/schiedsrichter/mutations";
import { FLPatchSchiedsrichterPayloadSchema } from "@/features/schiedsrichter/schemas";
import { handleUndoRequest } from "@/shared/utils/undoRoute";

import type { NextRequest } from "next/server";

/** Worded for the undo: the save's own sentence sends an admin to a form this toast has not got. */
const REPLAY_REFUSALS: Record<string, string> = {
  "REQ-ANONYMISE-002":
    "Für diesen Schiedsrichter wurden Name und Kontaktdaten inzwischen gelöscht, und die Rücknahme würde sie wieder eintragen. Die Löschung steht.",
};

export async function POST(request: NextRequest) {
  return handleUndoRequest(request, {
    mutationName: "undoAdminSchiedsrichterEdit",
    schema: FLPatchSchiedsrichterPayloadSchema,
    restore: async (payload) => {
      let operation;
      try {
        operation = await patchSchiedsrichter(payload);
      } catch (error) {
        const code = error instanceof APIBadStatusError && error.statusCode === 409 ? error.serverErrorCode : undefined;
        // The code is an unvalidated wire string, and an unguarded lookup reaches `Object.prototype`: `toString` selects a function.
        const refusal = code == null || !Object.hasOwn(REPLAY_REFUSALS, code) ? undefined : REPLAY_REFUSALS[code];
        if (refusal === undefined) throw error;

        return { refusal };
      }

      return operation.acknowledged ? {} : { refusal: "Die Rücknahme wurde abgebrochen. Prüfe die Schiedsrichterdaten." };
    },
    // `spiele` alone: the rename fans out into cached fixtures embedding this row (`docs/frontend/spec.md` §1.4).
    invalidate: () => {
      revalidateTag("spiele", { expire: 0 });
    },
  });
}
