import { APIBadStatusError } from "@/core/errors";
import { patchSaisonTeamKontakte } from "@/features/kontakte/mutations";
import { FLPatchSaisonTeamKontaktePayloadSchema } from "@/features/kontakte/schemas";
import { handleUndoRequest } from "@/shared/utils/undoRoute";

import type { NextRequest } from "next/server";

/** Worded for the undo: the save's own sentence sends an admin to a form this toast has not got. */
const REPLAY_REFUSALS: Record<string, string> = {
  "REQ-KONTAKT-001":
    "Die Kontakte dieser Saison wurden nach dem Speichern erneut geändert, meistens durch das Löschen einer Kontaktperson. " +
    "Die Rücknahme wurde nicht ausgeführt, damit die gelöschten Angaben nicht wieder eingetragen werden.",
};

export async function POST(request: NextRequest) {
  return handleUndoRequest(request, {
    mutationName: "undoAdminKontakteEdit",
    // The save's own payload, replayed: the endpoint replaces the block whole on the row its path
    // names. The precondition beside it is the save's AFTER image, that save having moved the row
    // past what the editor read.
    schema: FLPatchSaisonTeamKontaktePayloadSchema,
    restore: async (payload) => {
      let operation;
      try {
        operation = await patchSaisonTeamKontakte(payload);
      } catch (error) {
        const code = error instanceof APIBadStatusError && error.statusCode === 409 ? error.serverErrorCode : undefined;
        // The code is an unvalidated wire string, and an unguarded lookup reaches `Object.prototype`: `toString` selects a function.
        const refusal = code == null || !Object.hasOwn(REPLAY_REFUSALS, code) ? undefined : REPLAY_REFUSALS[code];
        if (refusal === undefined) throw error;

        return refusal;
      }

      return operation.acknowledged ? undefined : "Die Rücknahme wurde abgebrochen. Prüfe die Kontaktdaten.";
    },
    // Nothing to clear, for the reason `fl_frontend/src/features/kontakte/actions.ts :: patchSaisonTeamKontakteAction`
    // states at the save this replays: no cached read holds a contact person. The screen is refreshed
    // by the caller instead.
    invalidate: () => undefined,
  });
}
