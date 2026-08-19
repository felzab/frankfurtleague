/**
 * APP · the matchday edit's undo
 *
 * Puts a matchday's phase and span back the way they were — one of the admin mutations that are route
 * handlers rather than server actions. Revert to a server action when E592 is fixed upstream.
 *
 * Invariants:
 * - `revalidateTag`, never `updateTag` — the latter is the server-action form and throws here.
 * - It guards itself: `proxy.ts` matches `/admin/:path*` only, so the session check is the control.
 * - The client holds the payload — no admin write is recorded anywhere.
 * - One tag, matching the save: `GET /spiele` never joins `spieltage`, so no fixture read moves.
 * - The replay meets the same refusals the save did. Two of them can hold on the way back —
 *   `REQ-SPIELTAG-002` and `REQ-DATE-003` — because the world may have moved while the toast stood,
 *   so each answers in German rather than as a bare failure.
 */

import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";

import { getAdminSession } from "@/core/auth";
import { APIBadStatusError } from "@/core/errors";
import { logger } from "@/core/logging";
import { patchSpieltag } from "@/features/spieltage/mutations";
import { FLPatchSpieltagPayloadSchema } from "@/features/spieltage/schemas";
import { ADMIN_FORBIDDEN, runAdminMutation } from "@/shared/utils/adminMutation";

import type { NextRequest } from "next/server";

/** The refusals a replay can meet, in German — none of them has a field to land on from a toast. */
const REPLAY_REFUSALS: Record<string, string> = {
  "REQ-SPIELTAG-002":
    "In der ursprünglichen Phase sind inzwischen weniger Spiele vorgesehen, als der Spieltag enthält. Die Änderung steht weiterhin.",
  "REQ-DATE-002": "Der ursprüngliche Zeitraum liegt nicht mehr im Zeitraum der Saison. Die Änderung steht weiterhin.",
  "REQ-DATE-003": "Mindestens ein Spiel dieses Spieltags liegt außerhalb des ursprünglichen Zeitraums. Die Änderung steht weiterhin.",
};

export async function POST(request: NextRequest) {
  // Same-origin only, matching the other undos and `api/client-error`: every browser sends this
  // on a fetch, and the session check below is what actually authorizes the write.
  const secFetchSite = request.headers.get("sec-fetch-site");
  if (secFetchSite !== null && secFetchSite !== "same-origin") {
    return NextResponse.json({ success: false, error: "Access Denied" }, { status: 403 });
  }

  const result = await runAdminMutation("undoAdminSpieltagEdit", async () => {
    if (!(await getAdminSession())) {
      return { success: false as const, error: ADMIN_FORBIDDEN };
    }

    const body: unknown = await request.json().catch(() => null);
    const parsed = FLPatchSpieltagPayloadSchema.safeParse(body);
    if (!parsed.success) {
      return { success: false as const, error: "Die Rücknahme konnte nicht ausgeführt werden." };
    }

    let operation;
    try {
      operation = await patchSpieltag(parsed.data);
    } catch (error) {
      const code = error instanceof APIBadStatusError && error.statusCode === 409 ? error.serverErrorCode : undefined;
      const refusal = code == null ? undefined : REPLAY_REFUSALS[code];
      if (refusal !== undefined) return { success: false as const, error: refusal };
      throw error;
    }

    if (!operation.acknowledged) {
      return { success: false as const, error: "Die Rücknahme wurde abgebrochen. Prüfe den Spieltag." };
    }

    // Guarded, unlike the save: the write above is already committed, so an invalidation that throws
    // must not turn a restore that happened into a reported failure. `{ expire: 0 }` because the admin
    // is about to look at what they restored.
    try {
      revalidateTag("spieltage", { expire: 0 });
    } catch (invalidationError) {
      logger.warn("Undo committed but cache invalidation failed", { error_code: "FE-ACT-002", error: String(invalidationError) });
    }

    return { success: true as const, message: "Die Änderung wurde zurückgenommen." };
  });

  // Always 200: the body carries the outcome, and the client renders `error` in a toast. A non-2xx
  // would make `fetch` look like a transport failure for an ordinary, reportable refusal.
  return NextResponse.json(result);
}
