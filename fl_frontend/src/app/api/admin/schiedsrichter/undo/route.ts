import { revalidateTag } from "next/cache";

import { patchSchiedsrichter } from "@/features/schiedsrichter/mutations";
import { FLPatchSchiedsrichterPayloadSchema } from "@/features/schiedsrichter/schemas";
import { handleUndoRequest } from "@/shared/utils/undoRoute";

import type { NextRequest } from "next/server";

export async function POST(request: NextRequest) {
  return handleUndoRequest(request, {
    mutationName: "undoAdminSchiedsrichterEdit",
    schema: FLPatchSchiedsrichterPayloadSchema,
    restore: async (payload) => {
      const operation = await patchSchiedsrichter(payload);
      return operation.acknowledged ? undefined : "Die Rücknahme wurde abgebrochen. Prüfe die Schiedsrichterdaten.";
    },
    // `spiele` alone: the rename fans out into every fixture embedding this row, and those stay
    // cached. The row's own read is admin-tier and uncached, so it has no tag to clear.
    invalidate: () => {
      revalidateTag("spiele", { expire: 0 });
    },
  });
}
