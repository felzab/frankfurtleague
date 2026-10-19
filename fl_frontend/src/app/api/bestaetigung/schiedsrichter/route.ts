import { nullUnlessContractBreak } from "@/core/errors";
import { runAnsweringOwnCut } from "@/core/requestScope";
import { postSchiedsrichterBestaetigung } from "@/features/schiedsrichter/mutations";
import { getSchiedsrichterBestaetigungAnsicht, mapSchiedsrichterBestaetigungRefusal } from "@/features/schiedsrichter/queries";
import { FLSchiedsrichterBestaetigungPayloadSchema } from "@/features/schiedsrichter/schemas";
import { refusedDraftAnswer } from "@/shared/utils/actionError";
import { invalidatesOnWrite } from "@/shared/utils/adminMutation";
import { handlePublicRequest } from "@/shared/utils/publicRoute";
import { ANTWORT_NEU_OEFFNEN } from "@/shared/utils/reopenLink";

import type { GelesenerSchiedsrichterLink } from "@/features/schiedsrichter/queries";
import type { NextRequest } from "next/server";

// Never resolved in front of the mapper: a caller reading the view first spends a second backend read on
// every refusal naming one state alone.
/** This link's own view, for the refusals that name a floor or a state the view tells apart. A failed read is `null`. */
async function ansichtFuerToken(token: string): Promise<GelesenerSchiedsrichterLink | null> {
  // Under its own cut: the write was refused, so a deadline cutting this read is no unknown outcome. A contract break is
  // no failed read, and reaches the spine's log.
  return runAnsweringOwnCut(() => getSchiedsrichterBestaetigungAnsicht(token)).catch(nullUnlessContractBreak);
}

// A route handler and not a server action, for the reason `docs/frontend/spec.md` §1.3 gives.
/**
 * POST alone, and no GET: a mail scanner fetches every link in a message, and the same-origin guard
 * cannot tell a scanner's GET from a reader's, so a link that wrote on GET would confirm for the
 * scanner.
 */
export async function POST(request: NextRequest) {
  return handlePublicRequest(request, {
    routeName: "postSchiedsrichterBestaetigung",
    run: async () => {
      // Ahead of the fixture read joining this record, which will serve the referee's name by its scope:
      // the cached fixture list is dropped wherever the answer may stand, and nowhere a write was not sent.
      invalidatesOnWrite("spiele");
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
