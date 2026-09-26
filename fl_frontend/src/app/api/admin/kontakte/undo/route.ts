import { patchSaisonTeamKontakte } from "@/features/kontakte/mutations";
import { FLPatchSaisonTeamKontaktePayloadSchema } from "@/features/kontakte/schemas";
import { KONFLIKT_MIT_BESTEHENDEM } from "@/shared/utils/actionError";
import { handleUndoRequest, refusedReplay, replayRefusal } from "@/shared/utils/undoRoute";

import type { NextRequest } from "next/server";

/**
 * Its own close, the one undo row without the change standing: it already says the undo did not run,
 * and why. Worded for the undo, whose toast has not got the save's form.
 */
const STALE_BLOCK_REFUSAL: Record<string, string> = {
  "REQ-KONTAKT-001":
    "Die Kontakte dieser Saison wurden nach dem Speichern erneut geändert, meistens durch das Löschen einer Kontaktperson. " +
    "Die Rücknahme wurde nicht ausgeführt, damit die gelöschten Angaben nicht wieder eingetragen werden.",
};

const REPLAY_REFUSALS: Record<string, string> = {
  "DB-COMMON-002": KONFLIKT_MIT_BESTEHENDEM,
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
        // Each seat's consent label replayed as the earlier record stored it, never judged against the
        // save's admission (`fl_frontend/src/features/kontakte/actions.ts :: nenntZugelasseneFassungen`):
        // the save being undone has moved the stored label that admission reads.
        operation = await patchSaisonTeamKontakte(payload);
      } catch (error) {
        const stale = replayRefusal(error, STALE_BLOCK_REFUSAL);
        return stale === undefined ? refusedReplay(error, REPLAY_REFUSALS) : { refusal: stale };
      }

      return operation.acknowledged ? {} : { unclear: "Die Rücknahme wurde abgebrochen. Prüfe die Kontaktdaten." };
    },
    // Nothing to clear, for the reason `fl_frontend/src/features/kontakte/actions.ts :: patchSaisonTeamKontakteAction`
    // states at the save this replays: no cached read holds a contact person. The screen is refreshed
    // by the caller instead.
    invalidate: () => undefined,
  });
}
