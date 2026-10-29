import { postSchiedsrichterBestaetigung } from "@/features/schiedsrichter/mutations";
import { getSchiedsrichterBestaetigungAnsicht, mapSchiedsrichterBestaetigungRefusal } from "@/features/schiedsrichter/queries";
import { FLSchiedsrichterBestaetigungPayloadSchema } from "@/features/schiedsrichter/schemas";
import { refusedDraftAnswer } from "@/shared/utils/actionError";
import { handlePublicRequest, readAfterAnsweredWrite } from "@/shared/utils/publicRoute";
import { ANTWORT_NEU_OEFFNEN } from "@/shared/utils/reopenLink";

import type { GelesenerSchiedsrichterLink } from "@/features/schiedsrichter/queries";
import type { NextRequest } from "next/server";

const ROUTE_NAME = "postSchiedsrichterBestaetigung";

// Never resolved in front of the mapper: a caller reading the view first spends a second backend read on
// every refusal naming one state alone.
/** This link's own view, for the refusals that name a floor or a state the view tells apart. A failed read is `null`. */
async function ansichtFuerToken(token: string): Promise<GelesenerSchiedsrichterLink | null> {
  return readAfterAnsweredWrite(ROUTE_NAME, () => getSchiedsrichterBestaetigungAnsicht(token));
}

// A route handler and not a server action.
/**
 * POST alone, and no GET: a mail scanner fetches every link in a message, and the same-origin guard
 * cannot tell a scanner's GET from a reader's, so a link that wrote on GET would confirm for the
 * scanner.
 */
export async function POST(request: NextRequest) {
  return handlePublicRequest(request, {
    routeName: ROUTE_NAME,
    run: async () => {
      const body: unknown = await request.json().catch(() => null);

      const parsed = FLSchiedsrichterBestaetigungPayloadSchema.safeParse(body);

      if (!parsed.success) return { success: false as const, ...refusedDraftAnswer(parsed.error, ANTWORT_NEU_OEFFNEN) };

      let antwort;
      try {
        antwort = await postSchiedsrichterBestaetigung(parsed.data);
      } catch (error) {
        // The refusal belongs on the field or on the dead-link panel, not on the error page.
        const refusal = await mapSchiedsrichterBestaetigungRefusal(error, () => ansichtFuerToken(parsed.data.token));
        if (refusal === null) throw error;

        return { success: false as const, ...refusal };
      }

      // The echo alone: this person is shown what was stored for them and nothing else the write knows.
      return { success: true as const, umfang: antwort.umfang, medien: antwort.medien, bestaetigt_am: antwort.bestaetigt_am };
    },
  });
}
