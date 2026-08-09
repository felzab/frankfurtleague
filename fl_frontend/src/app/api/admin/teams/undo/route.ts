/**
 * APP · the club edit's undo
 *
 * Puts a club's own fields, its selected season's junction row, or both back the way they were —
 * one of the admin mutations that are route handlers rather than server actions (ADR-0062, the
 * E592 diagnosis). Revert to a server action when E592 is fixed upstream.
 *
 * Invariants:
 * - `revalidateTag`, never `updateTag` — the latter is the server-action form and throws here.
 * - It guards itself: `proxy.ts` matches `/admin/:path*` only, so the session check is the control.
 * - The client holds both payloads — no admin write is recorded anywhere (roadmap BE-15).
 * - The club half restores first, mirroring the save; a partial failure reports without invalidating.
 */

import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";

import { z } from "zod";

import { getAdminSession } from "@/core/auth";
import { logger } from "@/core/logging";
import { patchSaisonTeam, patchTeam } from "@/features/teams/mutations";
import { FLPatchSaisonTeamPayloadSchema, FLPatchTeamPayloadSchema } from "@/features/teams/schemas";
import { runAdminMutation } from "@/shared/utils/adminMutation";

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
  // Same-origin only, matching the match undo and `api/client-error`: every browser sends this on a
  // fetch, and the session check below is what actually authorizes the write.
  const secFetchSite = request.headers.get("sec-fetch-site");
  if (secFetchSite !== null && secFetchSite !== "same-origin") {
    return NextResponse.json({ success: false, error: "Access Denied" }, { status: 403 });
  }

  const result = await runAdminMutation("undoAdminTeamEdit", async () => {
    if (!(await getAdminSession())) {
      return { success: false as const, error: "Access Denied: Admin privileges missing" };
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
        // The club half may already be restored; reported rather than papered over, and the caches
        // are left alone for the match undo's reason.
        return {
          success: false as const,
          error:
            club === undefined
              ? "Die Rücknahme wurde abgebrochen. Prüfe die Saison-Zugehörigkeit."
              : "Nur die Stammdaten wurden zurückgesetzt. Prüfe die Saison-Zugehörigkeit.",
        };
      }
    }

    // Guarded, which the save does not need to be — see the match undo: every write above is already
    // committed, so an invalidation that throws must not turn a restore that HAPPENED into a
    // reported failure. `{ expire: 0 }` because the admin is about to look at what they restored.
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

  // Always 200: the body carries the outcome, and the client renders `error` in a toast. A non-2xx
  // would make `fetch` look like a transport failure for an ordinary, reportable refusal.
  return NextResponse.json(result);
}
