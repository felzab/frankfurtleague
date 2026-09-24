import { revalidateTag } from "next/cache";

import { z } from "zod";

import { patchSaisonTeam, patchTeam } from "@/features/teams/mutations";
import { FLPatchSaisonTeamPayloadSchema, FLPatchTeamPayloadSchema } from "@/features/teams/schemas";
import { KONFLIKT_MIT_BESTEHENDEM } from "@/shared/utils/actionError";
import { handleUndoRequest, refusedReplay } from "@/shared/utils/undoRoute";

import type { NextRequest } from "next/server";

const UndoRequestSchema = z
  .object({
    club: FLPatchTeamPayloadSchema.optional(),
    saison: FLPatchSaisonTeamPayloadSchema.optional(),
  })
  .refine((body) => body.club !== undefined || body.saison !== undefined, {
    error: "Nothing to restore",
  });

/**
 * The refusals the junction half of a replay can meet, in German written for the undo — the save's
 * own words send an admin to the group picker, which this toast has not got.
 */
const REPLAY_REFUSALS: Record<string, string> = {
  "REQ-ENTER-002": "Die ursprüngliche Gruppe gibt es in dieser Saison nicht mehr.",
  "REQ-ENTER-003": "Die ursprüngliche Gruppe ist inzwischen voll.",
  "REQ-ENTER-004": "Für dieses Team sind in dieser Saison inzwischen Spiele angelegt, deshalb kann es die Gruppe nicht allein wechseln.",
  // The club half's one refusal too, which that half replays against this table.
  "DB-COMMON-002": KONFLIKT_MIT_BESTEHENDEM,
};

/** What closes a refusal where the club half went back first, which the change standing would deny. */
const CLUB_HALF_RESTORED = "Nur die Stammdaten wurden zurückgesetzt.";

export async function POST(request: NextRequest) {
  return handleUndoRequest(request, {
    mutationName: "undoAdminTeamEdit",
    schema: UndoRequestSchema,
    restore: async ({ club, saison }) => {
      if (club !== undefined) {
        let operation;
        try {
          operation = await patchTeam(club);
        } catch (error) {
          // First of the two halves, so nothing is restored yet.
          return refusedReplay(error, REPLAY_REFUSALS);
        }

        if (!operation.acknowledged) {
          return { refusal: "Die Rücknahme wurde abgebrochen. Prüfe die Teamdaten." };
        }
      }

      if (saison !== undefined) {
        let operation;
        try {
          operation = await patchSaisonTeam(saison);
        } catch (error) {
          return club === undefined ? refusedReplay(error, REPLAY_REFUSALS) : refusedReplay(error, REPLAY_REFUSALS, CLUB_HALF_RESTORED);
        }

        if (!operation.acknowledged) {
          // The first half may already be restored; reported rather than papered over.
          return {
            refusal:
              club === undefined
                ? "Die Rücknahme wurde abgebrochen. Prüfe die Saison-Zugehörigkeit."
                : `${CLUB_HALF_RESTORED} Prüfe die Saison-Zugehörigkeit.`,
          };
        }
      }

      return {};
    },
    invalidate: ({ saison }) => {
      const tags = new Set(["teams", "spiele"]);
      if (saison !== undefined) {
        tags.add(`teams:saison_id:${saison.saison_id}`);
        tags.add(`spiele:saison_id:${saison.saison_id}`);
      }
      for (const tag of tags) {
        revalidateTag(tag, { expire: 0 });
      }
    },
  });
}
