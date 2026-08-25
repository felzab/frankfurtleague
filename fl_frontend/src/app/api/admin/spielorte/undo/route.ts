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
    // `spiele` alone: the rename fans out into every fixture embedding this row, and those stay
    // cached. The row's own read is admin-tier and uncached, so it has no tag to clear.
    invalidate: () => {
      revalidateTag("spiele", { expire: 0 });
    },
  });
}
