import { revalidateTag } from "next/cache";

import { patchSpielort } from "@/features/spielorte/mutations";
import { FLPatchSpielortPayloadSchema } from "@/features/spielorte/schemas";
import { handleUndoRequest } from "@/shared/utils/undoRoute";

import type { NextRequest } from "next/server";

export async function POST(request: NextRequest) {
  return handleUndoRequest(request, {
    mutationName: "undoAdminSpielortEdit",
    schema: FLPatchSpielortPayloadSchema,
    restore: async (payload) => {
      const operation = await patchSpielort(payload);
      return operation.acknowledged ? undefined : "Die Rücknahme wurde abgebrochen. Prüfe die Spielortdaten.";
    },
    invalidate: () => {
      revalidateTag("spielorte", { expire: 0 });
      revalidateTag("spiele", { expire: 0 });
    },
  });
}
