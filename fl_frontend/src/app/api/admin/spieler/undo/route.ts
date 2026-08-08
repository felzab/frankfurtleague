/**
 * APP · the squad edit's undo
 *
 * Puts a player's names, their selected season's squad row, or both back the way they were — the
 * third of the admin mutations that are route handlers rather than server actions
 * ([ADR-0062](../../../../../../../docs/_decisions/0062-every-page-owned-editors-undo-is-a-route-handler.md),
 * which widened ADR-0060's two-handler boundary to cover every page-owned editor).
 *
 * **The short version.** The undo is offered by a toast that outlives the page that raised it, so by
 * the time it is pressed the browser has left `/admin/spieler/[spieler_id]`. A server action
 * dispatched from the route it landed on makes Next re-render the editor segment it still holds in
 * the router tree, which raises Next's E592 invariant mid-stream and truncates the response — the
 * whole diagnosis is ADR-0055's. **Revert this to a server action when E592 is fixed upstream.**
 *
 *  INVARIANTS ───────────────────────────────────────────────────────────────────────────────────────────
 *
 *   • **`revalidateTag`, never `updateTag`.** The latter is the server-action form and throws here
 *     (spec I14). The tags are the same set the editor's save invalidates, because an undo is a write.
 *   • **It guards itself.** `proxy.ts` matches `/admin/:path*` and does not reach `/api`, so the
 *     session check below is the only control on this route.
 *   • **The client holds both payloads**, because nothing on the server does: no admin write is
 *     recorded anywhere (roadmap BE-15), so the player's previous state exists only in the page that
 *     was looking at it. That bounds the offer to one page session.
 *   • **The person half restores first**, mirroring the save's order; a failure between the two
 *     halves is reported without invalidating, exactly as the other two undos handle a partial batch
 *     — the caches are stale either way and the admin is being sent to look.
 *   • **One tag, unlike the club undo's four.** A squad row joins into no second resource: nothing
 *     under `spiele` or `teams` reads one, so `spieler` is the whole invalidation set.
 */

import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";

import { z } from "zod";

import { getAdminSession } from "@/core/auth";
import { logger } from "@/core/logging";
import { patchSaisonSpieler, patchSpieler } from "@/features/spieler/mutations";
import { FLPatchSaisonSpielerPayloadSchema, FLPatchSpielerPayloadSchema } from "@/features/spieler/schemas";
import { runAdminMutation } from "@/shared/utils/adminMutation";

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
  // Same-origin only, matching the other two undos and `api/client-error`: every browser sends this
  // on a fetch, and the session check below is what actually authorizes the write.
  const secFetchSite = request.headers.get("sec-fetch-site");
  if (secFetchSite !== null && secFetchSite !== "same-origin") {
    return NextResponse.json({ success: false, error: "Access Denied" }, { status: 403 });
  }

  const result = await runAdminMutation("undoAdminSpielerEdit", async () => {
    if (!(await getAdminSession())) {
      return { success: false as const, error: "Access Denied: Admin privileges missing" };
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

    // Guarded, which the save does not need to be — see the match undo: every write above is already
    // committed, so an invalidation that throws must not turn a restore that HAPPENED into a
    // reported failure. `{ expire: 0 }` because the admin is about to look at what they restored.
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
