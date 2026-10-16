import { postSpielerAdresswechsel } from "@/features/spieler/mutations";
import { mapSpielerAdresswechselRefusal } from "@/features/spieler/queries";
import { FLSpielerAdresswechselAntwortPayloadSchema } from "@/features/spieler/schemas";
import { refusedDraftAnswer } from "@/shared/utils/actionError";
import { handlePublicRequest } from "@/shared/utils/publicRoute";
import { ANTWORT_NEU_OEFFNEN } from "@/shared/utils/reopenLink";

import type { NextRequest } from "next/server";

// A route handler and POST alone, for the consent link's reasons (`docs/frontend/spec.md` §1.3): a
// mail scanner's GET must not answer for the person whether a mailbox is theirs.
export async function POST(request: NextRequest) {
  return handlePublicRequest(request, {
    routeName: "postSpielerAdresswechsel",
    run: async () => {
      const body: unknown = await request.json().catch(() => null);

      const parsed = FLSpielerAdresswechselAntwortPayloadSchema.safeParse(body);

      if (!parsed.success) return { success: false as const, ...refusedDraftAnswer(parsed.error, ANTWORT_NEU_OEFFNEN) };

      let antwort;
      try {
        antwort = await postSpielerAdresswechsel(parsed.data);
      } catch (error) {
        // The link dying between the open and the press is a panel, never the error page.
        const refusal = mapSpielerAdresswechselRefusal(error);
        if (refusal === null) throw error;

        return { success: false as const, ...refusal };
      }

      // No cache moves: no cached read holds a pupil's address.
      return { success: true as const, antwort: antwort.antwort };
    },
  });
}
