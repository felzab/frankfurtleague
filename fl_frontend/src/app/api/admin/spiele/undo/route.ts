/**
 * APP · the match edit's undo
 *
 * Puts a batch of fixtures back the way they were, in the order given (ADR-0041) — one of the
 * admin mutations that are route handlers rather than server actions (ADR-0049): the undo's toast
 * outlives the page that raised it, and a server action dispatched from the landing route
 * re-renders the abandoned editor segment, which trips Next's E592 invariant mid-stream and
 * truncates the response. Revert to a server action when E592 is fixed upstream.
 *
 * Invariants:
 * - `revalidateTag`, never `updateTag` — the latter is the server-action form and throws here.
 * - It guards itself: `proxy.ts` matches `/admin/:path*` only, so the session check is the control.
 * - The client holds every payload — no admin write is recorded anywhere.
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
        // The tags below are deliberately not invalidated on this path: some fixtures are written and
        // some are not, so the caches are stale either way and the admin is sent to check by hand.
        // Reporting the count is the point.
        return {
          success: false as const,
          error: `Die Rücknahme wurde nach ${restored} von ${payloads.length} Spielen abgebrochen. Prüfe die betroffenen Spiele.`,
        };
      }
      restored += 1;
    }

    // Guarded, unlike the save: every fixture above is already committed by the time this runs, so an
    // invalidation that throws must not turn a restore that happened into a reported failure. The cost
    // of swallowing it is a stale read.
    try {
      // `{ expire: 0 }` rather than a named profile: the second argument is how much staleness a reader
      // may still be served, and an undo tolerates none. It is the closest a route handler gets to
      // `updateTag`, which throws here (frontend spec I14).
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
