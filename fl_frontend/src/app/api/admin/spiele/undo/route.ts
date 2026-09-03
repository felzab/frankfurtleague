import { revalidateTag } from "next/cache";

import { z } from "zod";

import { APIBadStatusError } from "@/core/errors";
import { patchAdminSpielData } from "@/features/spiele/mutations";
import { FLPatchSpielDataPayloadSchema, FLSpielSchema } from "@/features/spiele/schemas";
import { handleUndoRequest } from "@/shared/utils/undoRoute";

import type { NextRequest } from "next/server";

const UndoRequestSchema = z.object({
  payloads: z.array(FLPatchSpielDataPayloadSchema).nonempty(),
  saison_id: FLSpielSchema.shape.saison_id,
});

// One replay can carry several fixtures, so no row below names a single one.

/**
 * The refusals a replay can meet, in German written for the undo — the save's own words name a field
 * this toast has not got, and a repair that would undo the undo.
 */
const REPLAY_REFUSALS: Record<string, string> = {
  "REQ-BOOKING-001": "Ein ursprünglicher Spielort oder Schiedsrichter ist inzwischen stillgelegt.",
  "REQ-CLASH-001": "Ein ursprünglicher Spielort oder Schiedsrichter ist zu dieser Zeit inzwischen für ein anderes Spiel eingeteilt.",
  "REQ-DATE-001": "Ein ursprüngliches Datum liegt nicht mehr im Zeitraum seines Spieltags.",
  "REQ-ELIGIBILITY-001":
    "Ein ursprünglich aufgestelltes Team ist inzwischen aus der Saison ausgeschieden und darf ab seinem Austritt nicht mehr aufgestellt sein.",
  "REQ-ELIGIBILITY-002": "Ein ursprünglich aufgestelltes Team nimmt nicht mehr an dieser Saison teil.",
  "REQ-RESULT-001": "Ein Spiel ist inzwischen gewertet, und der ursprüngliche Stand lässt eine Seite ohne Team.",
  "REQ-SPIELTAG-001": "Ein ursprünglich aufgestelltes Team spielt am selben Spieltag inzwischen schon in einem anderen Spiel.",
  "REQ-STATE-002": "Ein Spiel mit dem ursprünglichen Sonderereignis wird nicht gewertet und darf keine Tore tragen.",
  "REQ-STATE-003": "Ein Nichtantreten braucht beide Teams, und im ursprünglichen Stand ist ein Platz offen.",
  "REQ-WIRING-001": "Eine ursprüngliche Herkunft passt nicht mehr in den KO-Baum dieser Saison.",
  "REQ-WIRING-002": "Eine ursprüngliche Herkunft ist ein Platz in einer Gruppe, und das ist nur in der ersten KO-Runde der Saison möglich.",
  "REQ-WIRING-003": "Eine ursprüngliche Herkunft ist ein Platz in einer Gruppe, die es in dieser Saison nicht gibt.",
};

/** The second half of every refusal above: a cause alone leaves the admin unsure what the fixtures now hold. */
const CHANGE_STANDS = "Die Änderung steht weiterhin.";

export async function POST(request: NextRequest) {
  return handleUndoRequest(request, {
    mutationName: "undoAdminSpielEdit",
    schema: UndoRequestSchema,
    restore: async ({ payloads }) => {
      let restored = 0;
      for (const payload of payloads) {
        let operation;
        try {
          operation = await patchAdminSpielData(payload);
        } catch (error) {
          const code = error instanceof APIBadStatusError && error.statusCode === 409 ? error.serverErrorCode : undefined;
          // The code is an unvalidated wire string, and an unguarded lookup reaches `Object.prototype`: `toString` selects a function.
          const refusal = code == null || !Object.hasOwn(REPLAY_REFUSALS, code) ? undefined : REPLAY_REFUSALS[code];
          if (refusal === undefined) throw error;

          // The count, not `CHANGE_STANDS`, once a fixture is back: the change stands only in part.
          const outcome = restored === 0 ? CHANGE_STANDS : `Die Rücknahme wurde nach ${restored} von ${payloads.length} Spielen abgebrochen.`;
          return `${refusal} ${outcome}`;
        }

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
