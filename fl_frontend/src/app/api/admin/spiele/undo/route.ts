import { revalidateTag } from "next/cache";

import { APIBadStatusError } from "@/core/errors";
import { patchAdminSpielePaarungen } from "@/features/spiele/mutations";
import { FLPatchSpielePaarungenPayloadSchema, FLSpielSchema } from "@/features/spiele/schemas";
import { describeMovedSpiele } from "@/features/spiele/utils";
import { handleUndoRequest } from "@/shared/utils/undoRoute";

import type { NextRequest } from "next/server";

/**
 * The save's own report: a payload built from the page's props would revert a field another writer
 * moved while the editor stood open.
 */
const UndoRequestSchema = FLPatchSpielePaarungenPayloadSchema.extend({
  // This route's alone, naming the cached reads to clear: the endpoint derives the season from the
  // fixtures themselves.
  saison_id: FLSpielSchema.shape.saison_id,
});

// One replay carries every fixture, so no row below names a single one.

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

/**
 * The second half of every refusal above, and the whole of it: the replay is one transaction, so a
 * refusal on any fixture leaves every one of them where the save put it.
 */
const CHANGE_STANDS = "Die Änderung steht weiterhin.";

export async function POST(request: NextRequest) {
  return handleUndoRequest(request, {
    mutationName: "undoAdminSpielEdit",
    schema: UndoRequestSchema,
    restore: async ({ paarungen }) => {
      let operation;
      try {
        operation = await patchAdminSpielePaarungen({ paarungen });
      } catch (error) {
        const code = error instanceof APIBadStatusError && error.statusCode === 409 ? error.serverErrorCode : undefined;
        // The code is an unvalidated wire string, and an unguarded lookup reaches `Object.prototype`: `toString` selects a function.
        const refusal = code == null || !Object.hasOwn(REPLAY_REFUSALS, code) ? undefined : REPLAY_REFUSALS[code];
        if (refusal === undefined) throw error;

        return { refusal: `${refusal} ${CHANGE_STANDS}` };
      }

      if (!operation.acknowledged) {
        // Never `CHANGE_STANDS` here: an unacknowledged write may still have landed, so the admin is
        // sent to look rather than told the save is intact.
        return { refusal: "Die Rücknahme wurde abgebrochen. Prüfe die betroffenen Spiele." };
      }

      // The replay's own collateral, which the loop this replaced discarded: restoring the fixture the
      // save named empties the slots below it again, and a fixture the list does not put back has lost
      // its result for good.
      return { cost: describeMovedSpiele(operation.advanced_to, operation.bracket_faults, operation.released_sides) };
    },
    invalidate: ({ saison_id }) => {
      for (const tag of ["spiele", "teams", `spiele:saison_id:${saison_id}`, `teams:saison_id:${saison_id}`]) {
        revalidateTag(tag, { expire: 0 });
      }
    },
  });
}
