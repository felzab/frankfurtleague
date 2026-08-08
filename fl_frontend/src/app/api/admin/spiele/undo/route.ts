/**
 * APP · the match edit's undo
 *
 * Puts a batch of fixtures back the way they were, in the order given (ADR-0051). It is the one
 * admin mutation in this app that is NOT a server action, and the reason is an upstream Next.js bug
 * rather than a preference — [ADR-0055](../../../../../../../docs/_decisions/0055-the-undo-is-a-route-handler-until-e592-is-fixed.md)
 * carries the argument and the condition for reverting it.
 *
 * **The short version.** The undo is offered by a toast that outlives the page that raised it, so by
 * the time it is pressed the browser has already left `/admin/spiele/[spiel_id]`. A server action
 * dispatched from the route it landed on makes Next re-render the editor segment, which it still
 * holds in the router tree — and that render combines a prerendered postponed state with fallback
 * params, which Next asserts is impossible (error E592). The assertion fires mid-stream, truncating
 * the action's response to two bytes, so the client could not read a result and the write never
 * happened. A route handler renders no page tree at all, so there is nothing for that assertion to
 * fire on.
 *
 *  INVARIANTS ───────────────────────────────────────────────────────────────────────────────────────────
 *
 *   • **`revalidateTag`, never `updateTag`.** The latter is the server-action form and throws here
 *     (spec I14). The pair invalidated is the same one the save uses, because an undo is a write.
 *   • **It guards itself.** `proxy.ts` matches `/admin/:path*` and does not reach `/api`, so the
 *     session check below is the only control on this route — exactly as it is inside the action it
 *     replaced, which the proxy also exempts.
 *   • **The client holds every payload**, because nothing on the server does: no admin write is
 *     recorded anywhere (roadmap BE-15), so a fixture's previous state exists only in the page that
 *     was looking at it. That is what bounds this to one page session rather than making it a
 *     history feature.
 */

import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";

import { z } from "zod";

import { getAdminSession } from "@/core/auth";
import { logger } from "@/core/logging";
import { patchAdminSpielData } from "@/features/spiele/mutations";
import { FLPatchSpielDataPayloadSchema, FLSpielSchema } from "@/features/spiele/schemas";
import { runAdminMutation } from "@/shared/utils/adminMutation";

import type { NextRequest } from "next/server";

const UndoRequestSchema = z.object({
  payloads: z.array(FLPatchSpielDataPayloadSchema).nonempty(),
  saison_id: FLSpielSchema.shape.saison_id,
});

export async function POST(request: NextRequest) {
  // Same-origin only, matching `api/client-error`: every browser sends this on a fetch, and the
  // session check below is what actually authorizes the write.
  const secFetchSite = request.headers.get("sec-fetch-site");
  if (secFetchSite !== null && secFetchSite !== "same-origin") {
    return NextResponse.json({ success: false, error: "Access Denied" }, { status: 403 });
  }

  const result = await runAdminMutation("undoAdminSpielEdit", async () => {
    if (!(await getAdminSession())) {
      return { success: false as const, error: "Access Denied: Admin privileges missing" };
    }

    const body: unknown = await request.json().catch(() => null);
    const parsed = UndoRequestSchema.safeParse(body);
    if (!parsed.success) {
      return { success: false as const, error: "Die Rücknahme konnte nicht ausgeführt werden." };
    }

    const { payloads, saison_id } = parsed.data;

    let restored = 0;
    for (const payload of payloads) {
      const operation = await patchAdminSpielData(payload);
      if (!operation.acknowledged) {
        // The tags below are deliberately NOT invalidated on this path: some fixtures were written
        // and some were not, so the caches are stale either way and the admin is being sent to look
        // at the fixtures by hand. Reporting the count is the point — a partial restore is a worse
        // state than either end of it.
        return {
          success: false as const,
          error: `Die Rücknahme wurde nach ${restored} von ${payloads.length} Spielen abgebrochen. Prüfe die betroffenen Spiele.`,
        };
      }
      restored += 1;
    }

    // Guarded, which the save does not need to be. Every fixture above is already committed by the
    // time this runs, so an invalidation that throws must not turn a restore that HAPPENED into a
    // reported failure — the admin would go looking for work that was already done. The cost of
    // swallowing it is a stale read, and the caller refreshes the router itself.
    try {
      // `{ expire: 0 }` rather than a named profile: the second argument is how much staleness a
      // reader may still be served, and an undo tolerates none — the admin is about to look at the
      // fixture they just restored. It is the closest a route handler gets to `updateTag`, which is
      // the server-action-only form and throws here (spec I14).
      for (const tag of ["spiele", "teams", `spiele:saison_id:${saison_id}`, `teams:saison_id:${saison_id}`]) {
        revalidateTag(tag, { expire: 0 });
      }
    } catch (invalidationError) {
      logger.warn("Undo committed but cache invalidation failed", { error_code: "FE-ACT-002", error: String(invalidationError) });
    }

    return { success: true as const, message: "Die Änderung wurde zurückgenommen." };
  });

  // Always 200: the body carries the outcome, exactly as the server action's result did, and the
  // client renders `error` in a toast. A non-2xx here would make `fetch` look like a transport
  // failure for what is an ordinary, reportable refusal.
  return NextResponse.json(result);
}
