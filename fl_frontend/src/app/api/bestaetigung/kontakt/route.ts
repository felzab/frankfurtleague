// Redesign: goes with its last importer.
import { buildBewerbungWiderspruchEmail } from "@/core/bewerbungEmail";
import { frontend_config } from "@/core/config";
import { logger } from "@/core/logging";
import { postEinwilligung } from "@/features/bewerbungen/mutations";
import { rollenText, rolleText, sendBewerbungMail } from "@/features/bewerbungen/notifications";
import { getEinwilligungAnsicht } from "@/features/bewerbungen/queries";
import { FLBewerbungEinwilligungAntwortPayloadSchema } from "@/features/bewerbungen/schemas";
import { mapEinwilligungRefusal } from "@/features/bewerbungen/utils";
import { refusedDraftAnswer } from "@/shared/utils/actionError";
import { formatSpielDatum } from "@/shared/utils/format";
import { handlePublicRequest, readAfterAnsweredWrite } from "@/shared/utils/publicRoute";
import { ANTWORT_NEU_OEFFNEN } from "@/shared/utils/reopenLink";

import type { FLBewerbungEinwilligungAntwortResponse } from "@/features/bewerbungen/schemas";
import type { EinwilligungAnsicht } from "@/features/bewerbungen/types";
import type { NextRequest } from "next/server";

const ROUTE_NAME = "postEinwilligung";

// Never resolved in front of the mapper: a caller reading the view first spends a backend read on every refusal
// naming one state alone.
/** This link's own view, for the refusals that name a floor or a state the view tells apart. A failed read is `null`. */
async function ansichtFuerToken(token: string): Promise<EinwilligungAnsicht | null> {
  return readAfterAnsweredWrite(ROUTE_NAME, () => getEinwilligungAnsicht(token));
}

/**
 * The message this answer owes the Ansprechperson, if any.
 *
 * Awaited but never thrown from: the seat is already recorded when this runs, and the person who
 * pressed the button cannot repair a mailbox that is not theirs.
 */
async function notifyAnsprechperson(antwort: FLBewerbungEinwilligungAntwortResponse): Promise<void> {
  if (antwort.ergebnis !== "abgelehnt") return;

  if (antwort.ansprechperson_email === null) {
    // The seat this would have addressed is the seat that just emptied itself. Neither the address
    // nor the token reaches the line.
    logger.info("bewerbung.einwilligung_ohne_ansprechperson", { operation: "postEinwilligung", ergebnis: antwort.ergebnis });
    return;
  }

  // The serving origin, never `fl_frontend/src/core/brand.ts :: SITE_URL`: a stack that is not
  // production must not mail production links.
  const origin = frontend_config.AUTH_URL;

  await sendBewerbungMail({
    operation: "postEinwilligung",
    // The token is spent by the time this runs, so the same body cannot be composed twice: the key
    // guards nothing here and would refuse a genuine second answer from the paired seat.
    auftrag: { bewerbungId: antwort.bewerbung_id, anlass: "widerspruch" },
    recipients: [
      { address: antwort.ansprechperson_email, rollen: antwort.ansprechperson_rollen, rollenText: rollenText(antwort.ansprechperson_rollen) },
    ],
    buildMail: (rollen) =>
      buildBewerbungWiderspruchEmail({
        saisonId: antwort.saison_id,
        origin: origin,
        rollenText: rollen,
        // Named off the answer rather than a second read: the decline emptied the slot this
        // came from, and nothing left in the record can say whose entry was refused.
        abgelehnt: { vorname: antwort.vorname, rolleText: rolleText(antwort.rolle) },
        fristText: formatSpielDatum(antwort.bestaetigungsfrist),
      }),
  });
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

      // A season row's seat was typed in by an administrator: no application stands behind it, so no
      // Ansprechperson waits on the answer and neither of the application's messages is true of it.
      if (antwort.quelle === "bewerbung") await notifyAnsprechperson(antwort);

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
