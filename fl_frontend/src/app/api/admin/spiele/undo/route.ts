import { revalidateTag } from "next/cache";

import { z } from "zod";

import { patchAdminSpielData } from "@/features/spiele/mutations";
import { FLPatchSpielDataPayloadSchema, FLSpielSchema } from "@/features/spiele/schemas";
import { handleUndoRequest } from "@/shared/utils/undoRoute";

import type { NextRequest } from "next/server";

const UndoRequestSchema = z.object({
  payloads: z.array(FLPatchSpielDataPayloadSchema).nonempty(),
  saison_id: FLSpielSchema.shape.saison_id,
});

export async function POST(request: NextRequest) {
  return handleUndoRequest(request, {
    mutationName: "undoAdminSpielEdit",
    schema: UndoRequestSchema,
    restore: async ({ payloads }) => {
      let restored = 0;
      for (const payload of payloads) {
        const operation = await patchAdminSpielData(payload);
        if (!operation.acknowledged) {
          // Some fixtures are written and some are not, so the caches are stale either way and the count is what the admin needs.
          return `Die Rücknahme wurde nach ${restored} von ${payloads.length} Spielen abgebrochen. Prüfe die betroffenen Spiele.`;
        }
        restored += 1;
      }

      return undefined;
    },
    invalidate: ({ saison_id }) => {
      for (const tag of ["spiele", "teams", `spiele:saison_id:${saison_id}`, `teams:saison_id:${saison_id}`]) {
        revalidateTag(tag, { expire: 0 });
      }
    },
  });
}
