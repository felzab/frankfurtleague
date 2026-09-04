import { buildBewerbungAblehnungEmail, buildBewerbungVollstaendigEmail } from "@/core/bewerbungEmail";
import { logger } from "@/core/logging";
import { postEinwilligung } from "@/features/bewerbungen/mutations";
import { rollenText, rolleText, sendBewerbungMail } from "@/features/bewerbungen/notifications";
import { getEinwilligungAnsicht } from "@/features/bewerbungen/queries";
import { FLBewerbungEinwilligungAntwortPayloadSchema } from "@/features/bewerbungen/schemas";
import { mapEinwilligungRefusal, stampEinwilligungFassung } from "@/features/bewerbungen/utils";
import { VALIDATION_FAILED } from "@/shared/utils/adminMutation";
import { formatSpielDatum } from "@/shared/utils/format";
import { handlePublicRequest } from "@/shared/utils/publicRoute";
import { toFieldErrors } from "@/shared/utils/validation";

import type { FLBewerbungEinwilligungAntwortResponse } from "@/features/bewerbungen/schemas";
import type { LinkZustand } from "@/features/bewerbungen/types";
import type { NextRequest } from "next/server";

/** Which way a seat answered in another window went; a failed read throws rather than guessing one. */
async function beantworteterZustand(token: string): Promise<LinkZustand> {
  const { zustand } = await getEinwilligungAnsicht(token);

  // `gueltig` is the write's refusal and this read disagreeing, and the panel naming nobody is the
  // one answer that claims nothing about a record.
  return zustand === "gueltig" ? "ungueltig" : zustand;
}

/**
 * The message this answer owes the Ansprechperson, if any.
 *
 * Awaited but never thrown from: the seat is already recorded when this runs, and the person who
 * pressed the button cannot repair a mailbox that is not theirs.
 */
async function notifyAnsprechperson(antwort: FLBewerbungEinwilligungAntwortResponse): Promise<void> {
  const vollstaendig = antwort.ergebnis === "bestaetigt" && antwort.ausstehend.length === 0;
  if (!vollstaendig && antwort.ergebnis !== "abgelehnt") return;

  if (antwort.ansprechperson_email === null) {
    // The seat this would have addressed is the seat that just emptied itself. Neither the address
    // nor the token reaches the line (`docs/logging/spec.md :: L9`).
    logger.info("bewerbung.einwilligung_ohne_ansprechperson", { operation: "postEinwilligung", ergebnis: antwort.ergebnis });
    return;
  }

  await sendBewerbungMail({
    operation: "postEinwilligung",
    recipients: [{ address: antwort.ansprechperson_email, rollenText: rollenText(antwort.ansprechperson_rollen) }],
    buildMail: (rollen) =>
      vollstaendig
        ? buildBewerbungVollstaendigEmail({ saisonId: antwort.saison_id, rollenText: rollen })
        : buildBewerbungAblehnungEmail({
            saisonId: antwort.saison_id,
            rollenText: rollen,
            // Named off the answer rather than a second read: the decline emptied the slot this
            // came from, and nothing left in the record can say whose entry was refused.
            abgelehnt: { vorname: antwort.vorname, rolleText: rolleText(antwort.rolle) },
            fristText: formatSpielDatum(antwort.bestaetigungsfrist),
          }),
  });
}

/**
 * POST alone, and no GET: a mail scanner fetches every link in a message, and the same-origin guard
 * cannot tell a scanner's GET from a reader's, so a link that wrote on GET would confirm for the
 * scanner.
 */
export async function POST(request: NextRequest) {
  return handlePublicRequest(request, {
    routeName: "postEinwilligung",
    run: async () => {
      const body: unknown = await request.json().catch(() => null);

      // Stamped BEFORE the parse: the label is this server's to write, so judging the browser's own
      // would refuse a body on `text_version`, which no control renders and no reader would see.
      const gestempelt = typeof body === "object" && body !== null ? stampEinwilligungFassung(body) : body;
      const parsed = FLBewerbungEinwilligungAntwortPayloadSchema.safeParse(gestempelt);

      if (!parsed.success) {
        return { success: false as const, error: VALIDATION_FAILED, fieldErrors: toFieldErrors(parsed.error) };
      }

      let antwort;
      try {
        antwort = await postEinwilligung(parsed.data);
      } catch (error) {
        // The refusal belongs under the field or on the dead-link panel, not on the error page.
        const refusal = mapEinwilligungRefusal(error);
        if (refusal === null) throw error;

        // Destructured rather than spread whole: `nachlesen` is this handler's instruction, and the
        // page has no arm for it.
        const { nachlesen, ...panel } = refusal;

        if (nachlesen === true) return { success: false as const, zustand: await beantworteterZustand(parsed.data.token) };

        return { success: false as const, ...panel };
      }

      await notifyAnsprechperson(antwort);

      // The echo alone, never `ausstehend` and never an address: which other seats are open is the
      // submitter's business, and this person is shown what was stored for them and nothing more.
      return { success: true as const, ergebnis: antwort.ergebnis, geburtsdatum: antwort.geburtsdatum, whatsapp: antwort.whatsapp };
    },
  });
}
