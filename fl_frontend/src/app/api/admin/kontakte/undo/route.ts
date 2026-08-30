import { patchSaisonTeamKontakte } from "@/features/kontakte/mutations";
import { FLPatchSaisonTeamKontaktePayloadSchema } from "@/features/kontakte/schemas";
import { handleUndoRequest } from "@/shared/utils/undoRoute";

import type { NextRequest } from "next/server";

export async function POST(request: NextRequest) {
  return handleUndoRequest(request, {
    mutationName: "undoAdminKontakteEdit",
    // The save's own payload, replayed: the endpoint replaces the block whole on the row its path
    // names, so the pre-save block goes back through it with nothing to refuse it.
    schema: FLPatchSaisonTeamKontaktePayloadSchema,
    restore: async (payload) => {
      const operation = await patchSaisonTeamKontakte(payload);
      return operation.acknowledged ? undefined : "Die Rücknahme wurde abgebrochen. Prüfe die Kontaktdaten.";
    },
    // Nothing to clear, for the reason `fl_frontend/src/features/kontakte/actions.ts :: patchSaisonTeamKontakteAction`
    // states at the save this replays: no cached read holds a contact person. The screen is refreshed
    // by the caller instead.
    invalidate: () => undefined,
  });
}
