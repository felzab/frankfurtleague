import { postSchiedsrichterAdresswechsel } from "@/features/schiedsrichter/mutations";
import { mapSchiedsrichterAdresswechselRefusal } from "@/features/schiedsrichter/queries";
import { FLSchiedsrichterAdresswechselPayloadSchema } from "@/features/schiedsrichter/schemas";
import { refusedDraftAnswer } from "@/shared/utils/actionError";
import { handlePublicRequest } from "@/shared/utils/publicRoute";
import { ANTWORT_NEU_OEFFNEN } from "@/shared/utils/reopenLink";

import type { NextRequest } from "next/server";

// A route handler and POST alone, for the consent link's reasons (`docs/frontend/spec.md` §1.3): a
// mail scanner's GET must not answer for the person whether a mailbox is theirs.
export async function POST(request: NextRequest) {
  return handlePublicRequest(request, {
    routeName: "postSchiedsrichterAdresswechsel",
    run: async () => {
      const body: unknown = await request.json().catch(() => null);

      const parsed = FLSchiedsrichterAdresswechselPayloadSchema.safeParse(body);

      if (!parsed.success) return { success: false as const, ...refusedDraftAnswer(parsed.error, ANTWORT_NEU_OEFFNEN) };

      let antwort;
      try {
        antwort = await postSchiedsrichterAdresswechsel(parsed.data);
      } catch (error) {
        // The link dying between the open and the press is a panel, never the error page.
        const refusal = mapSchiedsrichterAdresswechselRefusal(error);
        if (refusal === null) throw error;

        return { success: false as const, ...refusal };
      }

      // No cache moves: the address reaches no cached read, every referee read being admin-tier.
      return { success: true as const, antwort: antwort.antwort };
    },
  });
}
