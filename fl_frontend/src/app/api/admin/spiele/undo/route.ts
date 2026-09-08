import { revalidateTag } from "next/cache";

import { z } from "zod";

import { APIBadStatusError } from "@/core/errors";
import { patchAdminSpielData, patchAdminSpielPaarung } from "@/features/spiele/mutations";
import { FLPatchSpielDataPayloadSchema, FLPatchSpielPaarungPayloadSchema, FLSpielSchema } from "@/features/spiele/schemas";
import { handleUndoRequest } from "@/shared/utils/undoRoute";

import type { NextRequest } from "next/server";

/**
 * Two shapes rather than one list, and the edited fixture is the one written wholesale: only it was
 * opened, so only it may have changed in a field the bracket resolution never touches.
 */
const UndoRequestSchema = z.object({
  edited: FLPatchSpielDataPayloadSchema,
  moved: z.array(FLPatchSpielPaarungPayloadSchema),
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
  // The restored STATE and never a result: the refusal is raised by the resolution the replay would
  // run, which a restored Herkunft moves as readily as a restored scoreline.
  "REQ-SPIELTAG-002": "Mit dem ursprünglichen Stand würde der KO-Baum ein Team in zwei Spielen desselben Spieltags aufstellen.",
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
    // **Order is the whole correctness argument.** The edited fixture goes first, so the resolution
    // has put each moved occupant back before the results below are written over them.
    restore: async ({ edited, moved }) => {
      const total = moved.length + 1;
      const writes = [() => patchAdminSpielData(edited), ...moved.map((paarung) => () => patchAdminSpielPaarung(paarung))];

      let restored = 0;
      for (const write of writes) {
        let operation;
        try {
          operation = await write();
        } catch (error) {
          const code = error instanceof APIBadStatusError && error.statusCode === 409 ? error.serverErrorCode : undefined;
          // The code is an unvalidated wire string, and an unguarded lookup reaches `Object.prototype`: `toString` selects a function.
          const refusal = code == null || !Object.hasOwn(REPLAY_REFUSALS, code) ? undefined : REPLAY_REFUSALS[code];
          if (refusal === undefined) throw error;

          // The count, not `CHANGE_STANDS`, once a fixture is back: the change stands only in part.
          const outcome = restored === 0 ? CHANGE_STANDS : `Die Rücknahme wurde nach ${restored} von ${total} Spielen abgebrochen.`;
          return `${refusal} ${outcome}`;
        }

        if (!operation.acknowledged) {
          // Some fixtures are written and some are not, so the caches are stale either way and the count is what the admin needs.
          return `Die Rücknahme wurde nach ${restored} von ${total} Spielen abgebrochen. Prüfe die betroffenen Spiele.`;
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
