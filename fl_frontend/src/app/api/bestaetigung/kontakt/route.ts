// Redesign: goes with its last importer.
import { postEinwilligung } from "@/features/bewerbungen/mutations";
import { getEinwilligungAnsicht } from "@/features/bewerbungen/queries";
import { FLBewerbungEinwilligungAntwortPayloadSchema } from "@/features/bewerbungen/schemas";
import { mapEinwilligungRefusal } from "@/features/bewerbungen/utils";
import { refusedDraftAnswer } from "@/shared/utils/actionError";
import { handlePublicRequest, readAfterAnsweredWrite } from "@/shared/utils/publicRoute";
import { ANTWORT_NEU_OEFFNEN } from "@/shared/utils/reopenLink";

import type { EinwilligungAnsicht } from "@/features/bewerbungen/types";
import type { NextRequest } from "next/server";

const ROUTE_NAME = "postEinwilligung";

// Never resolved in front of the mapper: a caller reading the view first spends a backend read on every refusal
// naming one state alone.
/** This link's own view, for the refusals that name a floor or a state the view tells apart. A failed read is `null`. */
async function ansichtFuerToken(token: string): Promise<EinwilligungAnsicht | null> {
  return readAfterAnsweredWrite(ROUTE_NAME, () => getEinwilligungAnsicht(token));
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

      const parsed = FLBewerbungEinwilligungAntwortPayloadSchema.safeParse(body);

      if (!parsed.success) return { success: false as const, ...refusedDraftAnswer(parsed.error, ANTWORT_NEU_OEFFNEN) };

      let antwort;
      try {
        antwort = await postEinwilligung(parsed.data);
      } catch (error) {
        // The refusal belongs under the field or on the dead-link panel, not on the error page.
        const refusal = await mapEinwilligungRefusal(error, () => ansichtFuerToken(parsed.data.token));
        if (refusal === null) throw error;

        return { success: false as const, ...refusal };
      }

      // The echo alone, never `ausstehend` and never an address: which other seats are open is the
      // submitter's business, and this person is shown what was stored for them and nothing more.
      return {
        success: true as const,
        ergebnis: antwort.ergebnis,
        geburtsdatum: antwort.geburtsdatum,
        whatsapp: antwort.whatsapp,
        medien: antwort.medien,
      };
    },
  });
}
