import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";

import { getAdminSession } from "@/core/auth";
import { logger } from "@/core/logging";
import { patchSaison } from "@/features/saisons/mutations";
import { FLPatchSaisonPayloadSchema } from "@/features/saisons/schemas";
import { ADMIN_FORBIDDEN, runAdminMutation } from "@/shared/utils/adminMutation";

import type { NextRequest } from "next/server";

export async function POST(request: NextRequest) {
  // Same-origin only; the session check below is what authorizes the write.
  const secFetchSite = request.headers.get("sec-fetch-site");
  if (secFetchSite !== null && secFetchSite !== "same-origin") {
    return NextResponse.json({ success: false, error: "Access Denied" }, { status: 403 });
  }

  const result = await runAdminMutation("undoAdminSaisonEdit", async () => {
    if (!(await getAdminSession())) {
      return { success: false as const, error: ADMIN_FORBIDDEN };
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

    // Guarded because the write is already committed: a failed invalidation must not report a
    // failure. `{ expire: 0 }` -- an undo tolerates no staleness, and `updateTag` throws here
    // (`docs/frontend/spec.md` I14).
    try {
      revalidateTag("saisons", { expire: 0 });
      revalidateTag("teams", { expire: 0 });
    } catch (invalidationError) {
      logger.warn("Undo committed but cache invalidation failed", { error_code: "FE-ACT-002", error: String(invalidationError) });
    }

    return { success: true as const, message: "Die Änderung wurde zurückgenommen." };
  });

  // Always 200: the body carries the outcome, so a non-2xx would read as a transport failure.
  return NextResponse.json(result);
}
