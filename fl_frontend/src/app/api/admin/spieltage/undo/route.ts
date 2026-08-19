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
  // Same-origin only; the session check below is what authorizes the write.
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

    // Guarded because the write is already committed: a failed invalidation must not report a
    // failure. `{ expire: 0 }` -- an undo tolerates no staleness, and `updateTag` throws here
    // (`docs/frontend/spec.md` I14).
    try {
      revalidateTag("spieltage", { expire: 0 });
    } catch (invalidationError) {
      logger.warn("Undo committed but cache invalidation failed", { error_code: "FE-ACT-002", error: String(invalidationError) });
    }

    return { success: true as const, message: "Die Änderung wurde zurückgenommen." };
  });

  // Always 200: the body carries the outcome, so a non-2xx would read as a transport failure.
  return NextResponse.json(result);
}
