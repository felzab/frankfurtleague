import { revalidateTag } from "next/cache";

import { z } from "zod";

import { patchSaisonTeam, patchTeam } from "@/features/teams/mutations";
import { FLPatchSaisonTeamPayloadSchema, FLPatchTeamPayloadSchema } from "@/features/teams/schemas";
import { handleUndoRequest } from "@/shared/utils/undoRoute";

import type { NextRequest } from "next/server";

const UndoRequestSchema = z
  .object({
    club: FLPatchTeamPayloadSchema.optional(),
    saison: FLPatchSaisonTeamPayloadSchema.optional(),
  })
  .refine((body) => body.club !== undefined || body.saison !== undefined, {
    error: "Nothing to restore",
  });

export async function POST(request: NextRequest) {
  return handleUndoRequest(request, {
    mutationName: "undoAdminTeamEdit",
    schema: UndoRequestSchema,
    restore: async ({ club, saison }) => {
      if (club !== undefined) {
        const operation = await patchTeam(club);
        if (!operation.acknowledged) {
          return "Die Rücknahme wurde abgebrochen. Prüfe die Teamdaten.";
        }
      }

      if (saison !== undefined) {
        const operation = await patchSaisonTeam(saison);
        if (!operation.acknowledged) {
          // The first half may already be restored; reported rather than papered over.
          return club === undefined
            ? "Die Rücknahme wurde abgebrochen. Prüfe die Saison-Zugehörigkeit."
            : "Nur die Stammdaten wurden zurückgesetzt. Prüfe die Saison-Zugehörigkeit.";
        }
      }

      return undefined;
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
