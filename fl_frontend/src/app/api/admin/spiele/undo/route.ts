import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";

import { z } from "zod";

import { getAdminSession } from "@/core/auth";
import { logger } from "@/core/logging";
import { patchAdminSpielData } from "@/features/spiele/mutations";
import { FLPatchSpielDataPayloadSchema, FLSpielSchema } from "@/features/spiele/schemas";
import { ADMIN_FORBIDDEN, runAdminMutation } from "@/shared/utils/adminMutation";

import type { NextRequest } from "next/server";

const UndoRequestSchema = z.object({
  payloads: z.array(FLPatchSpielDataPayloadSchema).nonempty(),
  saison_id: FLSpielSchema.shape.saison_id,
});

export async function POST(request: NextRequest) {
  // Same-origin only; the session check below is what authorizes the write.
  const secFetchSite = request.headers.get("sec-fetch-site");
  if (secFetchSite !== null && secFetchSite !== "same-origin") {
    return NextResponse.json({ success: false, error: "Access Denied" }, { status: 403 });
  }

  const result = await runAdminMutation("undoAdminSpielEdit", async () => {
    if (!(await getAdminSession())) {
      return { success: false as const, error: ADMIN_FORBIDDEN };
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
        // No invalidation here: some fixtures are written and some are not, so the caches are stale
        // either way and the count is what the admin needs.
        return {
          success: false as const,
          error: `Die Rücknahme wurde nach ${restored} von ${payloads.length} Spielen abgebrochen. Prüfe die betroffenen Spiele.`,
        };
      }
      restored += 1;
    }

    // Guarded because the write is already committed: a failed invalidation must not report a
    // failure. `{ expire: 0 }` -- an undo tolerates no staleness, and `updateTag` throws here
    // (`docs/frontend/spec.md` I14).
    try {
      for (const tag of ["spiele", "teams", `spiele:saison_id:${saison_id}`, `teams:saison_id:${saison_id}`]) {
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
