/**
 * APP · the season edit's undo
 *
 * Puts a season's dates and rules back the way they were — one of the admin mutations that are
 * route handlers rather than server actions
 * ([ADR-0062](../../../../../../../docs/_decisions/0062-every-page-owned-editors-undo-is-a-route-handler.md),
 * whose boundary is the PATTERN rather than a count: an undo belongs to a page-owned editor, and a
 * new page-owned editor may have one without superseding that ADR).
 *
 * **The short version.** The undo is offered by a toast that outlives the page that raised it, so by the
 * time it is pressed the browser has left `/admin/saisons/[saison_id]`. A server action dispatched from
 * the route it landed on makes Next re-render the editor segment it still holds in the router tree,
 * which raises Next's E592 invariant mid-stream and truncates the response — the whole diagnosis is
 * ADR-0062's. **Revert this to a server action when E592 is fixed upstream.**
 *
 *  INVARIANTS ───────────────────────────────────────────────────────────────────────────────────────────
 *
 *   • **`revalidateTag`, never `updateTag`.** The latter is the server-action form and throws here
 *     (spec I14). The tags are the same set the editor's save invalidates, because an undo is a write.
 *   • **It guards itself.** `proxy.ts` matches `/admin/:path*` and does not reach `/api`, so the session
 *     check below is the only control on this route.
 *   • **The client holds the payload**, because nothing on the server does: no admin write is recorded
 *     anywhere (roadmap BE-15), so the season's previous state exists only in the page that was looking
 *     at it. That bounds the offer to one page session.
 *   • **`status` is not restorable and is not on the payload.** The rollover is not undoable through
 *     here and must not become so: it is its own endpoint, the only one that writes `status`, and taking
 *     it back means activating the other season deliberately (ADR-0033).
 *   • **Two tags, matching the save.** `teams` travels with `saisons` because the league table is scored
 *     from `rules.win_points` and `draw_points` on every read rather than stored (ADR-0026).
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

    // Guarded, which the save does not need to be — see the match undo: the write above is already
    // committed, so an invalidation that throws must not turn a restore that HAPPENED into a reported
    // failure. `{ expire: 0 }` because the admin is about to look at what they restored.
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
