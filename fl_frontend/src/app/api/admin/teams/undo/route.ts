import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";

import { z } from "zod";

import { getAdminSession } from "@/core/auth";
import { logger } from "@/core/logging";
import { patchSaisonTeam, patchTeam } from "@/features/teams/mutations";
import { FLPatchSaisonTeamPayloadSchema, FLPatchTeamPayloadSchema } from "@/features/teams/schemas";
import { ADMIN_FORBIDDEN, runAdminMutation } from "@/shared/utils/adminMutation";

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
  // Same-origin only; the session check below is what authorizes the write.
  const secFetchSite = request.headers.get("sec-fetch-site");
  if (secFetchSite !== null && secFetchSite !== "same-origin") {
    return NextResponse.json({ success: false, error: "Access Denied" }, { status: 403 });
  }

  const result = await runAdminMutation("undoAdminTeamEdit", async () => {
    if (!(await getAdminSession())) {
      return { success: false as const, error: ADMIN_FORBIDDEN };
    }

    const body: unknown = await request.json().catch(() => null);
    const parsed = UndoRequestSchema.safeParse(body);
    if (!parsed.success) {
      return { success: false as const, error: "Die Rücknahme konnte nicht ausgeführt werden." };
    }

    const { club, saison } = parsed.data;

    if (club !== undefined) {
      const operation = await patchTeam(club);
      if (!operation.acknowledged) {
        return { success: false as const, error: "Die Rücknahme wurde abgebrochen. Prüfe die Teamdaten." };
      }
    }

    if (saison !== undefined) {
      const operation = await patchSaisonTeam(saison);
      if (!operation.acknowledged) {
        // The first half may already be restored; reported rather than papered over.
        return {
          success: false as const,
          error:
            club === undefined
              ? "Die Rücknahme wurde abgebrochen. Prüfe die Saison-Zugehörigkeit."
              : "Nur die Stammdaten wurden zurückgesetzt. Prüfe die Saison-Zugehörigkeit.",
        };
      }
    }

    // Guarded because the write is already committed: a failed invalidation must not report a
    // failure. `{ expire: 0 }` -- an undo tolerates no staleness, and `updateTag` throws here
    // (`docs/frontend/spec.md` I14).
    try {
      const tags = new Set(["teams", "spiele"]);
      if (saison !== undefined) {
        tags.add(`teams:saison_id:${saison.saison_id}`);
        tags.add(`spiele:saison_id:${saison.saison_id}`);
      }
      for (const tag of tags) {
        revalidateTag(tag, { expire: 0 });
      }
    } catch (invalidationError) {
      logger.warn("Undo committed but cache invalidation failed", { error_code: "FE-ACT-002", error: String(invalidationError) });
    }

    return { success: true as const, message: "Die Änderung wurde zurückgenommen." };
  });

  // Always 200: the body carries the outcome, so a non-2xx would read as a transport failure.
  return NextResponse.json(result);
}
