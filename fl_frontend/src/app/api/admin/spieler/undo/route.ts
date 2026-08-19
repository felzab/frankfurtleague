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
  // Same-origin only; the session check below is what authorizes the write.
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
        // The first half may already be restored; reported rather than papered over.
        return {
          success: false as const,
          error:
            person === undefined
              ? "Die Rücknahme wurde abgebrochen. Prüfe den Kadereintrag."
              : "Nur der Name wurde zurückgesetzt. Prüfe den Kadereintrag.",
        };
      }
    }

    // Guarded because the write is already committed: a failed invalidation must not report a
    // failure. `{ expire: 0 }` -- an undo tolerates no staleness, and `updateTag` throws here
    // (`docs/frontend/spec.md` I14).
    try {
      revalidateTag("spieler", { expire: 0 });
    } catch (invalidationError) {
      logger.warn("Undo committed but cache invalidation failed", { error_code: "FE-ACT-002", error: String(invalidationError) });
    }

    return { success: true as const, message: "Die Änderung wurde zurückgenommen." };
  });

  // Always 200: the body carries the outcome, so a non-2xx would read as a transport failure.
  return NextResponse.json(result);
}
