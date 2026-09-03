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
    // `spiele` alone: the rename fans out into cached fixtures embedding this row (`docs/frontend/spec.md` §1.4).
    invalidate: () => {
      revalidateTag("spiele", { expire: 0 });
    },
  });
}
