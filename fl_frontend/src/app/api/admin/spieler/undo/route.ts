import { revalidateTag } from "next/cache";

import { z } from "zod";

import { APIBadStatusError } from "@/core/errors";
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

/**
 * The refusals the squad half of a replay can meet, in German written for the undo — the save's own
 * words send an admin to the team picker, which this toast has not got.
 */
const REPLAY_REFUSALS: Record<string, string> = {
  "REQ-SQUAD-001": "Das ursprüngliche Team dieses Kadereintrags nimmt nicht mehr an dieser Saison teil.",
  "REQ-SQUAD-003": "Der Kader des ursprünglichen Teams ist für diese Saison inzwischen voll.",
  "REQ-SQUAD-004": "Die ursprüngliche Rolle ist in diesem Team inzwischen an einen anderen Spieler vergeben.",
};

/** The second half of every refusal above: a cause alone leaves the admin unsure what the squad now holds. */
const CHANGE_STANDS = "Die Änderung steht weiterhin.";

/** What replaces it where the person half went back first, which makes the sentence above untrue. */
const NAME_HALF_RESTORED = "Nur der Name wurde zurückgesetzt.";

export async function POST(request: NextRequest) {
  return handleUndoRequest(request, {
    mutationName: "undoAdminSpielerEdit",
    schema: UndoRequestSchema,
    restore: async ({ person, saison }) => {
      if (person !== undefined) {
        // No replay catch: the register declares no refusal against the season-independent person row.
        const operation = await patchSpieler(person);
        if (!operation.acknowledged) {
          return "Die Rücknahme wurde abgebrochen. Prüfe die Spielerdaten.";
        }
      }

      if (saison !== undefined) {
        let operation;
        try {
          operation = await patchSaisonSpieler(saison);
        } catch (error) {
          const code = error instanceof APIBadStatusError && error.statusCode === 409 ? error.serverErrorCode : undefined;
          // The code is an unvalidated wire string, and an unguarded lookup reaches `Object.prototype`: `toString` selects a function.
          const refusal = code == null || !Object.hasOwn(REPLAY_REFUSALS, code) ? undefined : REPLAY_REFUSALS[code];
          if (refusal === undefined) throw error;

          return `${refusal} ${person === undefined ? CHANGE_STANDS : NAME_HALF_RESTORED}`;
        }

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
