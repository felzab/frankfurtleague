import { z } from "zod";

import { patchSaisonSpieler, patchSpieler } from "@/features/spieler/mutations";
import { SQUAD_REPLAY_REFUSALS } from "@/features/spieler/refusals";
import { FLPatchSaisonSpielerPayloadSchema, FLPatchSpielerPayloadSchema } from "@/features/spieler/schemas";
import { handleUndoRequest, refusedReplay } from "@/shared/utils/undoRoute";

import type { NextRequest } from "next/server";

const UndoRequestSchema = z
  .object({
    person: FLPatchSpielerPayloadSchema.optional(),
    saison: FLPatchSaisonSpielerPayloadSchema.optional(),
  })
  .refine((body) => body.person !== undefined || body.saison !== undefined, {
    error: "Nothing to restore",
  });

/** What closes a refusal where the person half went back first, which the change standing would deny. */
const PERSON_HALF_RESTORED = "Nur die Personendaten wurden zurückgesetzt.";

export async function POST(request: NextRequest) {
  return handleUndoRequest(request, {
    mutationName: "undoAdminSpielerEdit",
    schema: UndoRequestSchema,
    restore: async ({ person, saison }) => {
      if (person !== undefined) {
        // No replay catch: the register declares no refusal against the season-independent person row.
        const operation = await patchSpieler(person);
        if (!operation.acknowledged) {
          return { unclear: "Die Rücknahme wurde abgebrochen. Prüfe die Spielerdaten." };
        }
      }

      if (saison !== undefined) {
        let operation;
        try {
          operation = await patchSaisonSpieler(saison);
        } catch (error) {
          return person === undefined
            ? refusedReplay(error, SQUAD_REPLAY_REFUSALS)
            : refusedReplay(error, SQUAD_REPLAY_REFUSALS, PERSON_HALF_RESTORED);
        }

        if (!operation.acknowledged) {
          // The first half may already be restored; reported rather than papered over.
          return {
            unclear:
              person === undefined
                ? "Die Rücknahme wurde abgebrochen. Prüfe den Kadereintrag."
                : `${PERSON_HALF_RESTORED} Prüfe den Kadereintrag.`,
          };
        }
      }

      return {};
    },
    tags: () => ["spieler"],
  });
}
