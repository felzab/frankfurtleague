import { revalidateTag } from "next/cache";

import { patchAdminSpielePaarungen } from "@/features/spiele/mutations";
import { PAARUNGEN_REPLAY_REFUSALS } from "@/features/spiele/refusals";
import { FLPatchSpielePaarungenPayloadSchema, FLSpielSchema } from "@/features/spiele/schemas";
import { describeMovedSpiele } from "@/features/spiele/utils";
import { handleUndoRequest, refusedReplay } from "@/shared/utils/undoRoute";

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

export async function POST(request: NextRequest) {
  return handleUndoRequest(request, {
    mutationName: "undoAdminSpielEdit",
    schema: UndoRequestSchema,
    restore: async ({ paarungen }) => {
      let operation;
      try {
        operation = await patchAdminSpielePaarungen({ paarungen });
      } catch (error) {
        // The change standing whole: the replay is one transaction, so a refusal on any fixture leaves
        // every one of them where the save put it.
        return refusedReplay(error, PAARUNGEN_REPLAY_REFUSALS);
      }

      if (!operation.acknowledged) {
        return { unclear: "Die Rücknahme wurde abgebrochen. Prüfe die betroffenen Spiele." };
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
