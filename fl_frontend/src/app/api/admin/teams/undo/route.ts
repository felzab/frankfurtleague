import { z } from "zod";

import { patchSaisonTeam, patchTeam } from "@/features/teams/mutations";
import { TEAM_REPLAY_REFUSALS } from "@/features/teams/refusals";
import { FLPatchSaisonTeamPayloadSchema, FLPatchTeamPayloadSchema } from "@/features/teams/schemas";
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
          return refusedReplay(error, TEAM_REPLAY_REFUSALS);
        }

        if (!operation.acknowledged) {
          return { unclear: "Die Rücknahme wurde abgebrochen. Prüfe die Teamdaten." };
        }
      }

      if (saison !== undefined) {
        let operation;
        try {
          operation = await patchSaisonTeam(saison);
        } catch (error) {
          return club === undefined
            ? refusedReplay(error, TEAM_REPLAY_REFUSALS)
            : refusedReplay(error, TEAM_REPLAY_REFUSALS, CLUB_HALF_RESTORED);
        }

        if (!operation.acknowledged) {
          // The first half may already be restored; reported rather than papered over.
          return {
            unclear:
              club === undefined
                ? "Die Rücknahme wurde abgebrochen. Prüfe die Saison-Zugehörigkeit."
                : `${CLUB_HALF_RESTORED} Prüfe die Saison-Zugehörigkeit.`,
          };
        }
      }

      return {};
    },
    tags: ({ saison }) =>
      saison === undefined
        ? ["teams", "spiele"]
        : ["teams", "spiele", `teams:saison_id:${saison.saison_id}`, `spiele:saison_id:${saison.saison_id}`],
  });
}
