import { postSpielerBestaetigung } from "@/features/registrierungen/mutations";
import { getSpielerBestaetigungAnsicht } from "@/features/registrierungen/queries";
import { FLRegistrierungBestaetigungPayloadSchema } from "@/features/registrierungen/schemas";
import { mapBestaetigungRefusal } from "@/features/registrierungen/utils";
import { refusedDraftAnswer } from "@/shared/utils/actionError";
import { handlePublicRequest, readAfterAnsweredWrite } from "@/shared/utils/publicRoute";
import { ANTWORT_NEU_OEFFNEN } from "@/shared/utils/reopenLink";

import type { GelesenerLink } from "@/features/registrierungen/utils";
import type { NextRequest } from "next/server";

const ROUTE_NAME = "postSpielerBestaetigung";

// Handed as a thunk and never resolved in front of the mapper: a caller reading the view first
// spends a second backend read on every refusal naming one state alone.
/** This link's own view, for the refusals that name a floor or a state the view tells apart. A failed read is `null`. */
async function ansichtFuerToken(token: string): Promise<GelesenerLink | null> {
  return readAfterAnsweredWrite(ROUTE_NAME, () => getSpielerBestaetigungAnsicht(token));
}

// A route handler and not a server action, for the reason `docs/frontend/spec.md` §1.3 gives.
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

      const parsed = FLRegistrierungBestaetigungPayloadSchema.safeParse(body);

      if (!parsed.success) return { success: false as const, ...refusedDraftAnswer(parsed.error, ANTWORT_NEU_OEFFNEN) };

      let antwort;
      try {
        antwort = await postSpielerBestaetigung(parsed.data);
      } catch (error) {
        // The refusal belongs under the field or on the dead-link panel, not on the error page.
        const refusal = await mapBestaetigungRefusal(error, () => ansichtFuerToken(parsed.data.token));
        if (refusal === null) throw error;

        return { success: false as const, ...refusal };
      }

      // The echo alone, and never the team or the season: this person is shown what was stored for
      // them and nothing more.
      return {
        success: true as const,
        ergebnis: antwort.ergebnis,
        geburtsdatum: antwort.geburtsdatum,
        umfang: antwort.umfang,
        medien: antwort.medien,
      };
    },
  });
}
