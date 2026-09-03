import z from "zod";

import { KUERZEL_LAENGE } from "@/features/bewerbungen/constants";
import { getBewerbungKuerzel } from "@/features/bewerbungen/queries";
import { handlePublicRequest } from "@/shared/utils/publicRoute";

import type { NextRequest } from "next/server";

/**
 * Judged before the value reaches a path segment. The form refuses anything else at the field, so
 * this arm answers a request the form did not make.
 */
const shorthandSchema = z.string().trim().length(KUERZEL_LAENGE);

const UNREADABLE = "Das Kürzel konnte nicht geprüft werden.";

/**
 * **ONE neutral answer**, separating no active club from a retired one and naming none: the check
 * is open to anybody, and either would read the roster back.
 */
export async function GET(request: NextRequest) {
  return handlePublicRequest(request, {
    routeName: "getBewerbungKuerzel",
    run: async () => {
      const parsed = shorthandSchema.safeParse(request.nextUrl.searchParams.get("shorthand"));

      if (!parsed.success) {
        return { success: false as const, error: UNREADABLE };
      }

      const antwort = await getBewerbungKuerzel(parsed.data);

      // The fact alone; the sentence a taken code gets is the form's, spelled once in
      // `fl_frontend/src/features/bewerbungen/utils.ts :: KUERZEL_VERGEBEN` so the blur and the
      // submit's own refusal cannot word it differently.
      return { success: true as const, vergeben: antwort.vergeben };
    },
  });
}
