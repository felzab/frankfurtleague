/**
 * APP · the season edit's undo
 *
 * Puts a season's dates and rules back the way they were — one of the admin mutations that are
 * route handlers rather than server actions (ADR-0049): the undo's toast outlives the page that
 * raised it, and a server action dispatched from the landing route re-renders the abandoned
 * editor segment, which trips Next's E592 mid-stream. Revert to a server action when E592 is fixed.
 *
 * Invariants:
 * - `revalidateTag`, never `updateTag` — the latter is the server-action form and throws here.
 * - It guards itself: `proxy.ts` matches `/admin/:path*` only, so the session check is the control.
 * - The client holds the payload — no admin write is recorded anywhere.
 * - `status` is not on the payload: the rollover is not undoable through here (ADR-0026).
 * - Two tags, matching the save: `teams` travels with `saisons` because the table reads `rules` (ADR-0019).
 */

import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";

import { getAdminSession } from "@/core/auth";
import { logger } from "@/core/logging";
import { patchSaison } from "@/features/saisons/mutations";
import { FLPatchSaisonPayloadSchema } from "@/features/saisons/schemas";
import { runAdminMutation } from "@/shared/utils/adminMutation";

import type { NextRequest } from "next/server";

export async function POST(request: NextRequest) {
  // Same-origin only, matching the other three undos and `api/client-error`: every browser sends this
  // on a fetch, and the session check below is what actually authorizes the write.
  const secFetchSite = request.headers.get("sec-fetch-site");
  if (secFetchSite !== null && secFetchSite !== "same-origin") {
    return NextResponse.json({ success: false, error: "Access Denied" }, { status: 403 });
  }

  const result = await runAdminMutation("undoAdminSaisonEdit", async () => {
    if (!(await getAdminSession())) {
      return { success: false as const, error: "Access Denied: Admin privileges missing" };
    }

    const body: unknown = await request.json().catch(() => null);
    const parsed = FLPatchSaisonPayloadSchema.safeParse(body);
    if (!parsed.success) {
      return { success: false as const, error: "Die Rücknahme konnte nicht ausgeführt werden." };
    }

    const operation = await patchSaison(parsed.data);
    if (!operation.acknowledged) {
      return { success: false as const, error: "Die Rücknahme wurde abgebrochen. Prüfe die Saisondaten." };
    }

    // Guarded, unlike the save: the write above is already committed, so an invalidation that throws
    // must not turn a restore that happened into a reported failure. `{ expire: 0 }` because the admin
    // is about to look at what they restored.
    try {
      revalidateTag("saisons", { expire: 0 });
      revalidateTag("teams", { expire: 0 });
    } catch (invalidationError) {
      logger.warn("Undo committed but cache invalidation failed", { error_code: "FE-ACT-002", error: String(invalidationError) });
    }

    return { success: true as const, message: "Die Änderung wurde zurückgenommen." };
  });

  // Always 200: the body carries the outcome, and the client renders `error` in a toast. A non-2xx would
  // make `fetch` look like a transport failure for an ordinary, reportable refusal.
  return NextResponse.json(result);
}
