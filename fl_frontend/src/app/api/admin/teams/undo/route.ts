import { revalidateTag } from "next/cache";

import { z } from "zod";

import { patchSaisonTeam, patchTeam } from "@/features/teams/mutations";
import { FLPatchSaisonTeamPayloadSchema, FLPatchTeamPayloadSchema } from "@/features/teams/schemas";
import { handleUndoRequest, replayRefusal } from "@/shared/utils/undoRoute";

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
  // The unique index's refusal in the shared reader's own sentence, which alone says nothing of the change.
  // The club half's one refusal too, which that half replays against this table.
  "DB-COMMON-002": "Der Eintrag steht im Konflikt mit einem, den es schon gibt.",
};

/** The second half of every refusal above: a cause alone leaves the admin unsure what the team now holds. */
const CHANGE_STANDS = "Die Änderung steht weiterhin.";

/** What replaces it where the club half went back first, which makes the sentence above untrue. */
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
          const refusal = replayRefusal(error, REPLAY_REFUSALS);
          if (refusal === undefined) throw error;

          // First of the two halves, so nothing is restored yet.
          return { refusal: `${refusal} ${CHANGE_STANDS}` };
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
          const refusal = replayRefusal(error, REPLAY_REFUSALS);
          if (refusal === undefined) throw error;

          return { refusal: `${refusal} ${club === undefined ? CHANGE_STANDS : CLUB_HALF_RESTORED}` };
        }

        if (!operation.acknowledged) {
          // The first half may already be restored; reported rather than papered over.
          return {
            refusal:
              club === undefined
                ? "Die Rücknahme wurde abgebrochen. Prüfe die Saison-Zugehörigkeit."
                : "Nur die Stammdaten wurden zurückgesetzt. Prüfe die Saison-Zugehörigkeit.",
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
