import { SPIELER_EINWILLIGUNG } from "@/core/einwilligung";
import { nenntLaufendeFassung } from "@/features/bewerbungen/utils";
import { postSpielerBestaetigung } from "@/features/registrierungen/mutations";
import { getSpielerBestaetigungAnsicht } from "@/features/registrierungen/queries";
import { FLRegistrierungBestaetigungPayloadSchema } from "@/features/registrierungen/schemas";
import { mapBestaetigungRefusal } from "@/features/registrierungen/utils";
import { refusedDraftAnswer } from "@/shared/utils/actionError";
import { handlePublicRequest } from "@/shared/utils/publicRoute";
import { ANTWORT_NEU_OEFFNEN } from "@/shared/utils/publicSubmit";

import type { NextRequest } from "next/server";

// Handed as a thunk and never resolved in front of the mapper: a caller reading the floor first
// spends a second backend read on every refusal that is not the age.
/**
 * The floor this link's own read answered, for the one refusal that names a number. A failed read
 * leaves that refusal unworded rather than guessing a floor.
 */
async function mindestalterFuerToken(token: string): Promise<number | null> {
  return getSpielerBestaetigungAnsicht(token).then(
    (gelesen) => (gelesen.zustand === "gueltig" ? gelesen.ansicht.mindestalter : null),
    () => null,
  );
}

// A route handler and not a server action, for the reason `docs/frontend/spec.md` §1.3 gives.
/**
 * POST alone, and no GET: a mail scanner fetches every link in a message, and the same-origin guard
 * cannot tell a scanner's GET from a reader's, so a link that wrote on GET would confirm for the
 * scanner.
 */
export async function POST(request: NextRequest) {
  return handlePublicRequest(request, {
    routeName: "postSpielerBestaetigung",
    run: async () => {
      const body: unknown = await request.json().catch(() => null);

      // Judged BEFORE the parse, by the check all three confirmation handlers share: a page opened
      // before a deploy moved the label posts the words its reader saw, and only the mail's link
      // reopens the page on the running ones.
      if (!nenntLaufendeFassung(body, SPIELER_EINWILLIGUNG.textVersion)) return { success: false as const, error: ANTWORT_NEU_OEFFNEN };

      const parsed = FLRegistrierungBestaetigungPayloadSchema.safeParse(body);

      if (!parsed.success) return { success: false as const, ...refusedDraftAnswer(parsed.error, ANTWORT_NEU_OEFFNEN) };

      let antwort;
      try {
        antwort = await postSpielerBestaetigung(parsed.data);
      } catch (error) {
        // The refusal belongs under the field or on the dead-link panel, not on the error page.
        const refusal = await mapBestaetigungRefusal(error, () => mindestalterFuerToken(parsed.data.token));
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
