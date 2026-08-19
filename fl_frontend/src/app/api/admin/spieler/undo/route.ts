/**
 * APP · the squad edit's undo
 *
 * Puts a player's names, their selected season's squad row, or both back the way they were — one
 * of the admin mutations that are route handlers rather than server actions. Revert to a server
 * action when E592 is fixed upstream.
 *
 * Invariants:
 * - `revalidateTag`, never `updateTag` — the latter is the server-action form and throws here.
 * - It guards itself: `proxy.ts` matches `/admin/:path*` only, so the session check is the control.
 * - The client holds both payloads — no admin write is recorded anywhere.
 * - The person half restores first, mirroring the save; a partial failure reports without invalidating.
 * - One tag, unlike the club undo's four: nothing under `spiele` or `teams` reads a squad row.
 */

import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";

import { z } from "zod";

import { getAdminSession } from "@/core/auth";
import { logger } from "@/core/logging";
import { patchSaisonSpieler, patchSpieler } from "@/features/spieler/mutations";
import { FLPatchSaisonSpielerPayloadSchema, FLPatchSpielerPayloadSchema } from "@/features/spieler/schemas";
import { ADMIN_FORBIDDEN, runAdminMutation } from "@/shared/utils/adminMutation";

import type { NextRequest } from "next/server";

const UndoRequestSchema = z
  .object({
    person: FLPatchSpielerPayloadSchema.optional(),
    saison: FLPatchSaisonSpielerPayloadSchema.optional(),
  })
  .refine((body) => body.person !== undefined || body.saison !== undefined, {
    error: "Nothing to restore",
  });

export async function POST(request: NextRequest) {
  // Same-origin only, matching the other undos and `api/client-error`: every browser sends this
  // on a fetch, and the session check below is what actually authorizes the write.
  const secFetchSite = request.headers.get("sec-fetch-site");
  if (secFetchSite !== null && secFetchSite !== "same-origin") {
    return NextResponse.json({ success: false, error: "Access Denied" }, { status: 403 });
  }

  const result = await runAdminMutation("undoAdminSpielerEdit", async () => {
    if (!(await getAdminSession())) {
      return { success: false as const, error: ADMIN_FORBIDDEN };
    }

    const body: unknown = await request.json().catch(() => null);
    const parsed = UndoRequestSchema.safeParse(body);
    if (!parsed.success) {
      return { success: false as const, error: "Die Rücknahme konnte nicht ausgeführt werden." };
    }

    const { person, saison } = parsed.data;

    if (person !== undefined) {
      const operation = await patchSpieler(person);
      if (!operation.acknowledged) {
        return { success: false as const, error: "Die Rücknahme wurde abgebrochen. Prüfe die Spielerdaten." };
      }
    }

    if (saison !== undefined) {
      const operation = await patchSaisonSpieler(saison);
      if (!operation.acknowledged) {
        // The person half may already be restored; reported rather than papered over, and the caches
        // are left alone for the match undo's reason.
        return {
          success: false as const,
          error:
            person === undefined
              ? "Die Rücknahme wurde abgebrochen. Prüfe den Kadereintrag."
              : "Nur der Name wurde zurückgesetzt. Prüfe den Kadereintrag.",
        };
      }
    }

    // Guarded, unlike the save: every write above is already committed, so an invalidation that throws
    // must not turn a restore that happened into a reported failure. `{ expire: 0 }` because the admin
    // is about to look at what they restored.
    try {
      revalidateTag("spieler", { expire: 0 });
    } catch (invalidationError) {
      logger.warn("Undo committed but cache invalidation failed", { error_code: "FE-ACT-002", error: String(invalidationError) });
    }

    return { success: true as const, message: "Die Änderung wurde zurückgenommen." };
  });

  // Always 200: the body carries the outcome, and the client renders `error` in a toast. A non-2xx
  // would make `fetch` look like a transport failure for an ordinary, reportable refusal.
  return NextResponse.json(result);
}
