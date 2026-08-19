import { revalidateTag } from "next/cache";

import { patchSaison } from "@/features/saisons/mutations";
import { FLPatchSaisonPayloadSchema } from "@/features/saisons/schemas";
import { handleUndoRequest } from "@/shared/utils/undoRoute";

import type { NextRequest } from "next/server";

export async function POST(request: NextRequest) {
  return handleUndoRequest(request, {
    mutationName: "undoAdminSaisonEdit",
    schema: FLPatchSaisonPayloadSchema,
    restore: async (payload) => {
      const operation = await patchSaison(payload);
      return operation.acknowledged ? undefined : "Die Rücknahme wurde abgebrochen. Prüfe die Saisondaten.";
    },
    invalidate: () => {
      revalidateTag("saisons", { expire: 0 });
      revalidateTag("teams", { expire: 0 });
    },
  });
}
