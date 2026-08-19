import { revalidateTag } from "next/cache";

import { z } from "zod";

import { patchSaisonSpieler, patchSpieler } from "@/features/spieler/mutations";
import { FLPatchSaisonSpielerPayloadSchema, FLPatchSpielerPayloadSchema } from "@/features/spieler/schemas";
import { handleUndoRequest } from "@/shared/utils/undoRoute";

import type { NextRequest } from "next/server";

const UndoRequestSchema = z
  .object({
    person: FLPatchSpielerPayloadSchema.optional(),
    saison: FLPatchSaisonSpielerPayloadSchema.optional(),
  })
  .refine((body) => body.person !== undefined || body.saison !== undefined, {
    error: "Nothing to restore",
  });

export async function POST(request: NextRequest) {
  return handleUndoRequest(request, {
    mutationName: "undoAdminSpielerEdit",
    schema: UndoRequestSchema,
    restore: async ({ person, saison }) => {
      if (person !== undefined) {
        const operation = await patchSpieler(person);
        if (!operation.acknowledged) {
          return "Die Rücknahme wurde abgebrochen. Prüfe die Spielerdaten.";
        }
      }

      if (saison !== undefined) {
        const operation = await patchSaisonSpieler(saison);
        if (!operation.acknowledged) {
          // The first half may already be restored; reported rather than papered over.
          return person === undefined
            ? "Die Rücknahme wurde abgebrochen. Prüfe den Kadereintrag."
            : "Nur der Name wurde zurückgesetzt. Prüfe den Kadereintrag.";
        }
      }

      return undefined;
    },
    invalidate: () => {
      revalidateTag("spieler", { expire: 0 });
    },
  });
}
